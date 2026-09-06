"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, FileText, ListTodo, Loader2, Settings, X, Zap } from "lucide-react";
import type { Memo, Task } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { applyTaskUpdate } from "@/lib/tasks/atomic-update";
import { generateNextRecurringTask } from "@/lib/tasks/recurring";
import { createQuickTask } from "@/lib/tasks/quick-create";
import { createNewNote, describeCreateNoteResult } from "@/lib/notes/create-note";
import { collectReadingItem } from "@/lib/reading/collect";
import { getPlatform } from "@/lib/platform/detect";
import { parseMemoTags } from "@/lib/memos/tags";
import { clearMemoDraft, loadMemoDraft, saveMemoDraft } from "@/lib/memos/draft";
import { enqueueMemoCreate, readMemoCreates } from "@/lib/offline/memo-queue";
import { isImeComposing } from "@/lib/input/submit-guard";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { isOnline } from "@/lib/offline/network";
import { CaptureDraft } from "@/lib/desktop/capture-draft";
import { emitDataChanged, insertMemoOptimistic, isNotchOpenPathAllowed, memoTimeLabel,
  NOTCH_QUICK_LINKS, NOTCH_TRIGGER_HIDDEN_KEY, NOTCH_PLAIN_DISPLAYS_KEY, readNotchTriggerHidden,
  selectPanelTasks, subscribeDataChanged } from "@/lib/desktop/notch";
import { cn } from "@/lib/utils";

const ICONS = { zap: Zap, book: BookOpen, note: FileText, todo: ListTodo, settings: Settings };
type QuickAction = "reading" | "note" | "task";
interface PanelInfo { session: number; mode: "hidden" | "preview" | "editing"; reduce_motion?: boolean; reduce_transparency?: boolean }
async function native(event: string, payload?: unknown) {
  if (getPlatform() !== "tauri") return;
  const { emit } = await import("@tauri-apps/api/event"); await emit(event, payload);
}

export function NotchPanel() {
  const supabase = useMemo(() => createClient(), []);
  const draft = useRef(new CaptureDraft());
  const account = useRef<string | null>(null);
  const epoch = useRef(0);
  const operation = useRef(0);
  const locked = useRef(false);
  const session = useRef(0);
  const [info, setInfo] = useState<PanelInfo>({ session: 0, mode: getPlatform() === "tauri" ? "hidden" : "editing" });
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [plain, setPlain] = useState(false);
  const [quick, setQuick] = useState<QuickAction | null>(null);
  const [quickValue, setQuickValue] = useState("");
  const [editing, setEditing] = useState<Memo | null>(null);
  const [editValue, setEditValue] = useState("");
  const [createdNote, setCreatedNote] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ task: Task; version: number } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const requestNumber = useRef(0);

  const refresh = useCallback(async () => {
    const id = account.current; if (!id) return;
    const ticket = ++requestNumber.current; const generation = epoch.current;
    setLoading(true); setLoadError(null);
    const end = new Date(); end.setHours(24, 0, 0, 0);
    try {
      // Filter first on the server; never fetch every task just to display three.
      const [memoResult, taskResult] = await Promise.allSettled([
        fetch("/api/memos?limit=3", { cache: "no-store" }).then(async (res) => { if (!res.ok) throw new Error(); return await res.json() as Memo[]; }),
        supabase.from("tasks").select("*").eq("user_id", id).is("deleted_at", null).is("parent_task_id", null)
          .in("status", ["todo", "in_progress"])
          .or(`and(schedule_start_at.not.is.null,schedule_start_at.lt.${end.toISOString()}),and(schedule_start_at.is.null,due_date.lt.${end.toISOString()})`)
          .order("is_pinned", { ascending: false }).order("schedule_start_at", { ascending: true, nullsFirst: false })
          .order("due_date", { ascending: true, nullsFirst: false }).limit(30),
      ]);
      if (generation !== epoch.current || ticket !== requestNumber.current) return;
      if (memoResult.status === "fulfilled") {
        const pending = readMemoCreates(localStorage, id).map((op) => ({ ...op.memo, user_id: id, tags: parseMemoTags(op.memo.content), created_at: new Date(op.created_at).toISOString(), updated_at: new Date(op.created_at).toISOString() } as Memo));
        setMemos([...pending, ...memoResult.value.filter((m) => !pending.some((p) => p.id === m.id))].slice(0, 3));
      }
      if (taskResult.status === "fulfilled" && !taskResult.value.error) setTasks((taskResult.value.data ?? []) as Task[]);
      if (memoResult.status === "rejected" || taskResult.status === "rejected" || taskResult.value.error) setLoadError("部分内容加载失败，已保留上次结果");
    } catch { if (generation === epoch.current) setLoadError("加载失败，请重试"); }
    finally { if (generation === epoch.current && ticket === requestNumber.current) setLoading(false); }
  }, [supabase]);

  useEffect(() => {
    let disposed = false; let authRevision = 0;
    const invalidate = () => { epoch.current += 1; };
    const changeUser = (id: string | null) => {
      if (disposed) return;
      setAuthReady(true);
      if (account.current === id && draft.current.userId === id) return;
      epoch.current++; operation.current++; locked.current = false; setBusy(false);
      account.current = id; setUserId(id);
      draft.current.reset(id, id ? loadMemoDraft(localStorage, id, "notch") : "");
      setInput(draft.current.content); setMemos([]); setTasks([]); setError(null); setMessage(""); setLoadError(null);
      setQuick(null); setQuickValue(""); setEditing(null); setEditValue(""); setCreatedNote(null); setUndo(null);
      void refresh();
    };
    const revision = authRevision;
    void supabase.auth.getSession().then(({ data: { session: auth } }) => { if (revision === authRevision) changeUser(auth?.user.id ?? null); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, auth) => {
      authRevision++; queueMicrotask(() => changeUser(auth?.user.id ?? null));
    });
    return () => { disposed = true; invalidate(); subscription.unsubscribe(); };
  }, [supabase, refresh]);

  useEffect(() => {
    let cancelled = false; const cleanups: (() => void)[] = [];
    setHidden(readNotchTriggerHidden());
    let showPlain = false; try { showPlain = localStorage.getItem(NOTCH_PLAIN_DISPLAYS_KEY) === "1"; } catch {}
    setPlain(showPlain);
    void subscribeDataChanged((payload) => {
      if ((!payload.user_id || payload.user_id === account.current) && payload.origin !== "notch-panel") void refresh();
    }).then((off) => { if (cancelled) off(); else cleanups.push(off); });
    if (getPlatform() === "tauri") void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen<PanelInfo>("notch-panel-shown", ({ payload }) => {
        if (cancelled || !payload || !["hidden", "preview", "editing"].includes(payload.mode)) return;
        const changed = session.current !== payload.session;
        session.current = payload.session; setInfo(payload);
        if (payload.mode !== "hidden") void refresh();
        if (changed) { setSettings(false); setMessage(""); }
        if (payload.mode === "editing" && changed) requestAnimationFrame(() => textarea.current?.focus());
      });
      if (cancelled) { off(); return; } cleanups.push(off);
      await native("notch-trigger-visibility", { visible: !readNotchTriggerHidden(), plain_displays: showPlain });
      await native("notch-panel-ready");
    })();
    const synced = () => void refresh(); window.addEventListener("organize:memos-synced", synced);
    return () => { cancelled = true; cleanups.forEach((off) => off()); window.removeEventListener("organize:memos-synced", synced); };
  }, [refresh]);
  useEffect(() => { void native("notch-state", { session: info.session, busy }); }, [busy, info.session]);
  useEffect(() => { if (settings) backButton.current?.focus(); }, [settings]);
  const close = () => { void native("notch-collapse", { session: session.current }); };
  const openPath = (path: string) => { if (isNotchOpenPathAllowed(path)) void native("notch-open-path", path); };
  const activate = () => { void native("notch-edit", { session: session.current }); requestAnimationFrame(() => textarea.current?.focus()); };
  const setText = (value: string) => {
    draft.current.edit(value); setInput(value); setError(null); setMessage("");
    if (account.current && !saveMemoDraft(localStorage, account.current, "notch", value)) setError("本机草稿保存失败，请保持窗口打开并联网保存");
  };
  const start = () => {
    if (locked.current || !account.current) return null;
    locked.current = true; setBusy(true); setError(null); setMessage("");
    void native("notch-state", { session: session.current, busy: true });
    return { operation: ++operation.current, epoch: epoch.current, userId: account.current };
  };
  const finish = (op: { operation: number }) => { if (operation.current === op.operation) { locked.current = false; setBusy(false); } };
  const notify = (topic: "memos" | "tasks" | "notes", id: string) => void emitDataChanged({ topic, origin: "notch-panel", user_id: id });

  const save = async () => {
    const submission = draft.current.begin(); if (!submission || submission.content.length > 5000) return;
    const op = start(); if (!op) return;
    try {
      let saved: Memo | null = null; let queued = false;
      try {
        if (!isOnline()) throw new TypeError("Failed to fetch");
        const res = await fetch("/api/memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: submission.content, id: submission.id, expected_user_id: submission.userId }) });
        if (res.status >= 500) throw new TypeError("Failed to fetch");
        if (!res.ok) throw new Error("保存被拒绝，草稿已保留，请确认登录账号后重试");
        saved = await res.json() as Memo;
      } catch (e) {
        if (!isNetworkSaveError(e)) throw e;
        if (!enqueueMemoCreate(localStorage, submission.userId, { op_id: submission.id, memo: { id: submission.id, content: submission.content }, created_at: Date.now() }).persisted) throw new Error("本地存储不可用，内容尚未保存，请联网重试");
        queued = true;
      }
      if (!draft.current.belongsToCurrentUser(submission)) return;
      if (draft.current.acknowledge(submission)) { setInput(""); clearMemoDraft(localStorage, submission.userId, "notch"); }
      if (saved) { setMemos((list) => insertMemoOptimistic(list, saved!)); notify("memos", op.userId); }
      setMessage(queued ? "已保存在本机，联网后同步" : "已保存");
      window.dispatchEvent(new Event("organize:memos-queued"));
    } catch (e) { if (op.epoch === epoch.current) setError(e instanceof Error ? e.message : "保存失败，草稿已保留"); }
    finally { finish(op); }
  };
  const complete = async (task: Task) => {
    const op = start(); if (!op) return;
    try {
      const result = await applyTaskUpdate(supabase, task.id, { status: "done", completed_at: new Date().toISOString() }, task.sync_version ?? null, crypto.randomUUID());
      if (op.epoch !== epoch.current) return;
      if (result.status !== "applied" && result.status !== "already_applied") throw new Error("完成失败，任务可能已被其他窗口修改");
      setTasks((list) => list.filter((t) => t.id !== task.id)); notify("tasks", op.userId);
      if (task.recurrence_rule) { await generateNextRecurringTask(supabase, task.id); setMessage("已完成；重复任务请在主窗口管理"); }
      else if (result.status === "applied") setUndo({ task, version: result.syncVersion });
    } catch (e) { if (op.epoch === epoch.current) setError(e instanceof Error ? e.message : "操作失败"); }
    finally { finish(op); }
  };
  const undoComplete = async () => {
    const previous = undo; if (!previous) return; const op = start(); if (!op) return;
    try {
      const result = await applyTaskUpdate(supabase, previous.task.id, { status: previous.task.status, completed_at: previous.task.completed_at }, previous.version, crypto.randomUUID());
      if (op.epoch !== epoch.current) return;
      if (result.status !== "applied" && result.status !== "already_applied") throw new Error("任务已变化，请在主窗口确认，未覆盖较新的修改");
      setUndo(null); notify("tasks", op.userId); void refresh();
    } catch (e) { if (op.epoch === epoch.current) setError(e instanceof Error ? e.message : "撤销失败"); }
    finally { finish(op); }
  };
  const saveEdit = async () => {
    const target = editing; if (!target || !editValue.trim()) return; const op = start(); if (!op) return;
    try {
      const res = await fetch(`/api/memos/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: editValue }) });
      if (op.epoch !== epoch.current) return;
      if (!res.ok) throw new Error("修改失败，草稿已保留");
      clearMemoDraft(localStorage, op.userId, `notch-edit:${target.id}`); setEditing(null); notify("memos", op.userId); void refresh();
    } catch { if (op.epoch === epoch.current) setError("修改失败，草稿已保留"); }
    finally { finish(op); }
  };
  const submitQuick = async () => {
    if (!quick || (quick !== "note" && !quickValue.trim())) return; const op = start(); if (!op) return;
    const action = quick; const value = quickValue;
    try {
      if (action === "note") {
        const result = await createNewNote(supabase, { title: value, expectedUserId: op.userId });
        if (op.epoch !== epoch.current) return;
        if (result.status !== "created" && result.status !== "queued") throw new Error(describeCreateNoteResult(result));
        if (result.status === "queued" && !result.persisted) throw new Error("本机存储失败，标题已保留");
        setCreatedNote(result.noteId); setMessage(describeCreateNoteResult(result)); notify("notes", op.userId);
      } else if (action === "task") {
        const due = new Date(); due.setHours(23,59,59,999);
        const result = await createQuickTask(supabase, { title: value, dueDate: due.toISOString(), expectedUserId: op.userId });
        if (op.epoch !== epoch.current) return;
        if (result.status !== "created" && result.status !== "queued") throw new Error(result.status === "failed" ? result.message : "请先登录");
        if (result.status === "queued" && result.persisted === false) throw new Error("本机存储失败，输入已保留");
        setTasks((items) => [result.task, ...items]); setMessage(result.status === "queued" ? "待办已保存在本机，联网后同步" : "已添加待办"); notify("tasks", op.userId);
      } else {
        const result = await collectReadingItem(value, { expectedUserId: op.userId });
        if (op.epoch !== epoch.current) return;
        if (result.status === "error") throw new Error(result.message || "保存失败");
        setMessage(result.status === "duplicate" ? "该链接已在稍后读中" : result.status === "saved-link-only" ? "已保存链接，正文暂不可用" : "已保存到稍后读");
      }
      clearMemoDraft(localStorage, op.userId, `notch-quick:${action}`); setQuick(null); setQuickValue("");
    } catch (e) { if (op.epoch === epoch.current) setError(e instanceof Error ? e.message : "创建失败，输入已保留"); }
    finally { finish(op); }
  };
  const visibility = (nextHidden: boolean, nextPlain: boolean) => {
    setHidden(nextHidden); setPlain(nextPlain);
    try { localStorage.setItem(NOTCH_TRIGGER_HIDDEN_KEY, nextHidden ? "1" : "0"); localStorage.setItem(NOTCH_PLAIN_DISPLAYS_KEY, nextPlain ? "1" : "0"); } catch { setError("设置未能保存，重启后可能恢复默认"); }
    void native("notch-trigger-visibility", { visible: !nextHidden, plain_displays: nextPlain });
  };
  const preview = info.mode === "preview";
  const panelTasks = selectPanelTasks(tasks);
  const enabled = Boolean(userId) && !preview;
  const buttonClass = "rounded-lg px-2 py-1.5 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40";
  return <section aria-label="快速记录" data-reduce-motion={info.reduce_motion || undefined} data-reduce-transparency={info.reduce_transparency || undefined}
    className={cn("organize-capture-panel relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#1d1d1f]/95 text-neutral-100 shadow-xl", info.reduce_transparency && "!bg-[#1d1d1f]")}
    onKeyDown={(e) => { if (isImeComposing(e) || e.key !== "Escape") return; e.preventDefault(); e.stopPropagation(); if (settings) { setSettings(false); requestAnimationFrame(() => settingsButton.current?.focus()); } else if (editing) setEditing(null); else if (quick) setQuick(null); else close(); }}>
    <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2"><span className="text-xs font-medium">快速记录</span><div className="flex items-center gap-1"><button ref={settingsButton} aria-label="快速记录设置" className={buttonClass} onClick={() => setSettings(true)}><Settings size={15}/></button><button aria-label="关闭快速记录" className={buttonClass} onClick={close}><X size={15}/></button></div></header>
    {settings ? <div className="flex-1 space-y-5 overflow-y-auto p-4"><button ref={backButton} className={buttonClass} onClick={() => { setSettings(false); requestAnimationFrame(() => settingsButton.current?.focus()); }}>返回快速记录</button><h2 className="text-sm font-medium">顶部入口</h2><label className="flex justify-between gap-3 text-sm"><span>显示顶部快捷入口</span><input type="checkbox" checked={!hidden} onChange={(e) => visibility(!e.target.checked, plain)}/></label><label className="flex justify-between gap-3 text-sm"><span>在无刘海屏幕也显示把手</span><input type="checkbox" checked={plain} onChange={(e) => visibility(hidden, e.target.checked)}/></label><p className="text-xs leading-relaxed text-neutral-400">悬停只预览，点击后开始编辑。隐藏入口后仍可从菜单栏“快速记录”或 ⌘⇧M 打开。</p><button className={buttonClass} onClick={() => openPath("/settings")}>打开完整设置</button></div> : <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <textarea ref={textarea} aria-label="速记内容" disabled={!enabled} value={input} maxLength={5000} rows={3} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (isImeComposing(e)) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void save(); } }}
          placeholder={authReady && !userId ? "登录后开始记录" : "记点什么…"} className="min-h-[96px] w-full resize-y rounded-xl border border-white/15 bg-white/5 p-3 text-sm leading-relaxed outline-none focus:border-sky-300"/>
        <div className="flex items-center justify-between text-[11px] text-neutral-400"><span>Enter 保存 · Shift+Enter 换行 · {input.length}/5000</span><button disabled={!enabled || busy || !input.trim()} className={buttonClass} onClick={() => void save()}>{busy ? <Loader2 aria-label="保存中" size={14} className="animate-spin"/> : "保存"}</button></div>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}{message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
        {!authReady ? <p className="text-xs text-neutral-400">正在确认登录状态…</p> : !userId ? <button className={buttonClass} onClick={() => openPath("/login")}>去登录</button> : <>
          {quick && <div className="space-y-2 rounded-lg border border-white/10 p-2"><div className="flex items-center justify-between text-xs"><span>{quick === "reading" ? "添加链接" : quick === "note" ? "新建笔记" : "添加今天待办"}</span><button aria-label="关闭快捷输入" className={buttonClass} onClick={() => setQuick(null)}><X size={14}/></button></div><input aria-label="快捷输入内容" autoFocus disabled={busy} value={quickValue} onChange={(e) => { setQuickValue(e.target.value); saveMemoDraft(localStorage,userId,`notch-quick:${quick}`,e.target.value); }} onKeyDown={(e) => {if (!isImeComposing(e) && e.key === "Enter") {e.preventDefault(); void submitQuick();}}} className="w-full rounded border border-white/15 bg-white/5 p-2 text-sm"/><button disabled={busy} className={buttonClass} onClick={() => void submitQuick()}>添加</button></div>}
          {createdNote && <button className={buttonClass} onClick={() => openPath(`/notes/${createdNote}`)}>继续编辑这篇笔记</button>}
          {loadError && <div role="alert" className="text-xs text-red-300">{loadError}<button className={buttonClass} onClick={() => void refresh()}>重试</button></div>}
          <div className="border-t border-white/10 pt-3"><div className="mb-2 flex justify-between text-xs text-neutral-400"><h2>今天与逾期</h2><button className={buttonClass} onClick={() => openPath("/tasks")}>查看全部</button></div>{panelTasks.length === 0 ? <p className="text-xs text-neutral-400">{loading ? "加载中…" : loadError ? "暂无法确认任务" : "今天没有待办"}</p> : panelTasks.map((task) => <div key={task.id} className="flex items-center gap-2"><button aria-label={`完成 ${task.title}`} disabled={busy} className={buttonClass} onClick={() => void complete(task)}><Check size={16}/></button><button className="min-w-0 flex-1 truncate py-2 text-left text-sm" onClick={() => openPath(`/tasks?task=${task.id}`)}>{task.title}</button></div>)}{undo && <button className={buttonClass} disabled={busy} onClick={() => void undoComplete()}>撤销完成「{undo.task.title.slice(0,16)}」</button>}</div>
          <div className="border-t border-white/10 pt-3"><h2 className="mb-2 text-xs text-neutral-400">最近速记</h2>{memos.length === 0 && <p className="text-xs text-neutral-400">{loading ? "加载中…" : loadError ? "暂无法确认速记" : "还没有速记"}</p>}{memos.map((memo) => editing?.id === memo.id ? <div key={memo.id} className="space-y-2"><textarea aria-label="编辑速记" autoFocus maxLength={5000} disabled={busy} value={editValue} onChange={(e) => {setEditValue(e.target.value);saveMemoDraft(localStorage,userId,`notch-edit:${memo.id}`,e.target.value);}} className="w-full rounded bg-white/5 p-2 text-sm"/><button disabled={busy} className={buttonClass} onClick={() => void saveEdit()}>保存修改</button><button className={buttonClass} onClick={() => setEditing(null)}>返回</button></div> : <button key={memo.id} className="flex w-full gap-2 rounded-lg py-2 text-left text-xs hover:bg-white/5" onClick={() => {setEditing(memo);setEditValue(loadMemoDraft(localStorage,userId,`notch-edit:${memo.id}`) || memo.content);}}><span className="shrink-0 text-neutral-400">{memoTimeLabel(memo.created_at)}</span><span className="line-clamp-2 leading-relaxed">{memo.content}</span></button>)}</div>
        </>}
      </div>
      <nav aria-label="快速创建" className="grid shrink-0 grid-cols-5 border-t border-white/10 p-2">{NOTCH_QUICK_LINKS.map((link) => {const Icon = ICONS[link.icon];return <button key={link.action} disabled={busy || (!userId && link.action !== "open-settings-modal")} className={buttonClass} onClick={() => {
        if (link.action === "open-settings-modal") setSettings(true);
        else if (link.action === "focus-memo") {setQuick(null);textarea.current?.focus();}
        else {const action = link.action === "add-note" ? "note" : link.action === "add-task" ? "task" : "reading";setQuick(action);setQuickValue(userId ? loadMemoDraft(localStorage,userId,`notch-quick:${action}`) : "");}
      }}><Icon size={16} className="mx-auto mb-1"/>{link.label}</button>;})}</nav>
    </>}
    {preview && <button aria-label="开始快速记录" onClick={activate} className="absolute inset-0 flex items-end justify-center rounded-2xl bg-black/15 pb-4"><span className="rounded-full bg-sky-700 px-4 py-2 text-sm text-white shadow-lg">点击开始记录 · ⌘⇧M</span></button>}
  </section>;
}
