"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, FileText, ListTodo, Loader2, LogIn, Settings, X, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { applyTaskUpdate } from "@/lib/tasks/atomic-update";
import { generateNextRecurringTask } from "@/lib/tasks/recurring";
import { createQuickTask } from "@/lib/tasks/quick-create";
import { createNewNote } from "@/lib/notes/create-note";
import { collectReadingItem } from "@/lib/reading/collect";
import { getPlatform } from "@/lib/platform/detect";
import { parseMemoTags } from "@/lib/memos/tags";
import { insertMemoOptimistic, isNotchOpenPathAllowed, memoTimeLabel, NOTCH_QUICK_LINKS, readNotchTriggerHidden, selectPanelTasks } from "@/lib/desktop/notch";
import { cn } from "@/lib/utils";
import type { Memo, Task } from "@organize/shared";

const QUICK_ICONS = { zap: Zap, book: BookOpen, note: FileText, todo: ListTodo, settings: Settings } as const;
const EXIT_ANIMATION_MS = 120;
type QuickAction = "reading" | "note" | "task" | null;

export function NotchPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [shownKey, setShownKey] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [editingMemoContent, setEditingMemoContent] = useState("");
  const [savingMemo, setSavingMemo] = useState(false);
  const [memoEditError, setMemoEditError] = useState<string | null>(null);
  const [quickAction, setQuickAction] = useState<QuickAction>(null);
  const [quickValue, setQuickValue] = useState("");
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickMessage, setQuickMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [triggerHidden, setTriggerHidden] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const exitingRef = useRef(false);

  const refreshData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setLoggedIn(Boolean(user));
    if (!user) return;
    void fetch("/api/memos?limit=3", { cache: "no-store" }).then(async (res) => {
      if (res.ok) setMemos(((await res.json()) as Memo[]).slice(0, 3));
    }).catch(() => {});
    setLoadingTasks(true);
    try {
      const { data } = await supabase.from("tasks").select("*").eq("user_id", user.id)
        .order("is_pinned", { ascending: false }).order("sort_order", { ascending: true }).order("created_at", { ascending: false });
      setTasks((data || []) as Task[]);
    } finally { setLoadingTasks(false); }
  }, [supabase]);

  useEffect(() => { void refreshData(); }, [refreshData]);
  useEffect(() => {
    setTriggerHidden(readNotchTriggerHidden());
    if (getPlatform() !== "tauri") return;
    let cancelled = false; let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen("notch-panel-shown", () => {
      if (exitingRef.current) return;
      setExiting(false); setShownKey((key) => key + 1); void refreshData();
      requestAnimationFrame(() => textareaRef.current?.focus());
    })).then((fn) => { if (cancelled) fn?.(); else unlisten = fn; });
    return () => { cancelled = true; unlisten?.(); };
  }, [refreshData]);
  useEffect(() => { if (quickAction) requestAnimationFrame(() => quickInputRef.current?.focus()); }, [quickAction]);

  const requestCollapse = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true; setExiting(true);
    setTimeout(() => { void import("@tauri-apps/api/event").then(({ emit }) => emit("notch-collapse")); exitingRef.current = false; }, EXIT_ANIMATION_MS);
  }, []);
  const openPath = useCallback((path: string) => { if (isNotchOpenPathAllowed(path)) void import("@tauri-apps/api/event").then(({ emit }) => emit("notch-open-path", path)); }, []);

  const save = useCallback(async () => {
    const content = input.trim(); if (!content || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch("/api/memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (!res.ok) throw new Error();
      const memo = await res.json() as Memo;
      setMemos((list) => insertMemoOptimistic(list, memo)); setInput(""); setSavedFlash(true);
      setTimeout(() => { setSavedFlash(false); requestCollapse(); }, 500);
    } catch { setSaveError("保存失败，请检查网络后重试"); } finally { setSaving(false); }
  }, [input, saving, requestCollapse]);

  const saveEditedMemo = useCallback(async () => {
    const id = editingMemoId; const content = editingMemoContent.trim();
    if (!id || !content || savingMemo) return;
    setSavingMemo(true); setMemoEditError(null);
    try {
      const res = await fetch(`/api/memos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (!res.ok) throw new Error();
      const updated = await res.json() as Memo;
      setMemos((list) => list.map((memo) => memo.id === updated.id ? updated : memo));
      setEditingMemoId(null); setEditingMemoContent("");
    } catch { setMemoEditError("修改失败，请稍后重试"); } finally { setSavingMemo(false); }
  }, [editingMemoId, editingMemoContent, savingMemo]);

  const toggleTask = useCallback(async (task: Task) => {
    setTasks((cur) => cur.filter((item) => item.id !== task.id)); setTaskError(null);
    const result = await applyTaskUpdate(supabase, task.id, { status: "done", completed_at: new Date().toISOString() }, task.sync_version ?? null, crypto.randomUUID());
    if (result.status === "applied" || result.status === "already_applied") { if (await generateNextRecurringTask(supabase, task.id)) void refreshData(); }
    else { setTaskError("勾选失败，请稍后重试"); void refreshData(); }
  }, [supabase, refreshData]);

  const submitQuickAction = useCallback(async () => {
    const value = quickValue.trim(); if (!quickAction || quickSubmitting) return;
    setQuickSubmitting(true); setQuickMessage(null);
    try {
      if (quickAction === "reading") {
        const result = await collectReadingItem(value); setQuickMessage(result.status === "error" ? result.message || "添加失败" : result.status === "duplicate" ? "该链接已在稍后读中" : "已保存到稍后读");
        if (result.status !== "error") { setQuickValue(""); setQuickAction(null); }
      } else if (quickAction === "note") {
        const note = await createNewNote(supabase, { title: value }); setQuickMessage(note ? "已新建笔记" : "新建笔记失败");
        if (note) { setQuickValue(""); setQuickAction(null); }
      } else {
        const today = new Date(); today.setHours(23, 59, 59, 999);
        const result = await createQuickTask(supabase, { title: value, dueDate: today.toISOString() });
        if (result.status === "created" || result.status === "queued") { setTasks((current) => [result.task, ...current]); setQuickMessage(result.status === "queued" ? "已离线创建，联网后同步" : "已添加待办"); setQuickValue(""); setQuickAction(null); window.dispatchEvent(new CustomEvent("organize:tasks-changed")); }
        else if (result.status === "unauthenticated") setQuickMessage("请先登录");
        else if (result.status === "failed") setQuickMessage(result.message);
      }
    } finally { setQuickSubmitting(false); }
  }, [quickAction, quickSubmitting, quickValue, supabase]);

  const handleQuickAction = (action: (typeof NOTCH_QUICK_LINKS)[number]["action"]) => {
    setQuickMessage(null);
    if (action === "focus-memo") { setQuickAction(null); textareaRef.current?.focus(); }
    else if (action === "open-settings-modal") setSettingsOpen(true);
    else { setQuickValue(""); setQuickAction(action === "add-reading" ? "reading" : action === "add-note" ? "note" : "task"); }
  };
  const setHidden = (hidden: boolean) => {
    try { localStorage.setItem("organize.notch-trigger-hidden", hidden ? "1" : "0"); } catch {}
    setTriggerHidden(hidden);
    void import("@tauri-apps/api/event").then(({ emit }) => emit("notch-trigger-visibility", { visible: !hidden }));
  };
  const panelTasks = useMemo(() => selectPanelTasks(tasks), [tasks]);

  return <div key={shownKey} className={cn("notch-panel-in relative flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-black/60 bg-[#1d1d1f]/95 text-neutral-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl", exiting && "notch-panel-out")}>
    <div className="border-b border-white/5 p-3.5"><div className="relative"><textarea ref={textareaRef} value={input} onChange={(event) => { setInput(event.target.value); setSaveError(null); }} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === "Escape") { event.preventDefault(); requestCollapse(); } if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void save(); } }} autoFocus rows={3} placeholder="记点什么… Enter 保存，Shift+Enter 换行" className="h-[96px] w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-relaxed text-neutral-100 placeholder:text-neutral-500 focus:border-white/25 focus:outline-none" />{savedFlash && <span className="absolute right-2.5 top-2.5 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[11px] text-emerald-300">已保存 ✓</span>}</div><div className="mt-1.5 flex h-4 items-center justify-between px-1"><span className="text-[11px] text-neutral-500">#标签 会自动归档</span>{saveError ? <span className="text-[11px] text-red-400">{saveError}</span> : <button type="button" onClick={() => void save()} disabled={!input.trim() || saving} className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-100 disabled:opacity-40">{saving && <Loader2 className="h-3 w-3 animate-spin" />}保存</button>}</div></div>
    {loggedIn === false ? <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><Zap className="h-6 w-6 text-neutral-500" /><p className="text-sm text-neutral-300">登录后可用</p><button type="button" onClick={() => openPath("/login")} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs">去登录</button></div> : <>
      {quickAction && <div className="border-b border-white/5 bg-white/[0.03] px-3.5 py-2.5"><div className="mb-1.5 flex items-center justify-between text-xs text-neutral-300"><span>{quickAction === "reading" ? "添加稍后读链接" : quickAction === "note" ? "新建笔记（标题可选）" : "添加今天待办"}</span><button type="button" onClick={() => setQuickAction(null)}><X className="h-3.5 w-3.5" /></button></div><div className="flex gap-2"><input ref={quickInputRef} value={quickValue} onChange={(e) => setQuickValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuickAction(null); if (e.key === "Enter") void submitQuickAction(); }} placeholder={quickAction === "reading" ? "粘贴链接" : quickAction === "note" ? "无标题笔记" : "待办内容"} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs outline-none focus:border-white/30" /><button type="button" onClick={() => void submitQuickAction()} disabled={quickSubmitting || (quickAction !== "note" && !quickValue.trim())} className="rounded-lg bg-white/10 px-2.5 text-xs disabled:opacity-40">{quickSubmitting ? "…" : "添加"}</button></div></div>}
      {quickMessage && <p className="px-3.5 pt-2 text-[11px] text-neutral-400">{quickMessage}</p>}
      <div className="flex h-[128px] flex-col border-b border-white/5 px-3.5 py-2.5"><div className="mb-1.5 flex items-center justify-between"><h3 className="text-xs font-medium text-neutral-400">今日待办</h3>{taskError && <span className="text-[11px] text-red-400">{taskError}</span>}</div><div className="flex-1 space-y-1 overflow-hidden">{panelTasks.length === 0 ? <p className="pt-3 text-center text-xs text-neutral-500">{loadingTasks ? "加载中…" : "今天没有待办 ✨"}</p> : panelTasks.map((task) => <button key={task.id} type="button" onClick={() => void toggleTask(task)} title={task.title} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-white/5"><span className="flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border border-white/25"><Check className="h-3 w-3 text-transparent" /></span><span className="truncate text-[13px] text-neutral-200">{task.title}</span></button>)}</div></div>
      <div className="flex flex-1 flex-col overflow-hidden px-3.5 py-2.5"><h3 className="mb-1.5 text-xs font-medium text-neutral-400">最近速记</h3><div className="flex-1 space-y-1.5 overflow-y-auto">{memos.length === 0 ? <p className="pt-3 text-center text-xs text-neutral-500">还没有速记</p> : memos.map((memo) => editingMemoId === memo.id ? <div key={memo.id} className="rounded-lg bg-white/5 p-1.5"><textarea autoFocus value={editingMemoContent} onChange={(e) => { setEditingMemoContent(e.target.value); setMemoEditError(null); }} onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Escape") { e.preventDefault(); setEditingMemoId(null); } if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEditedMemo(); } }} rows={3} className="w-full resize-none bg-transparent text-[12px] text-neutral-200 outline-none" /><div className="flex items-center justify-between"><span className="text-[10px] text-red-400">{memoEditError}</span><span className="flex gap-2"><button type="button" onClick={() => setEditingMemoId(null)} className="text-[11px] text-neutral-400">取消</button><button type="button" onClick={() => void saveEditedMemo()} disabled={savingMemo || !editingMemoContent.trim()} className="text-[11px] text-sky-300 disabled:opacity-40">{savingMemo ? "保存中" : "保存"}</button></span></div></div> : <button key={memo.id} type="button" onClick={() => { setEditingMemoId(memo.id); setEditingMemoContent(memo.content); setMemoEditError(null); }} className="flex w-full gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] leading-relaxed hover:bg-white/5"><span className="flex-none pt-px text-[10px] text-neutral-500">{memoTimeLabel(memo.created_at)}</span><span className="line-clamp-2 text-neutral-300">{renderMemoContent(memo.content)}</span></button>)}</div></div>
      <div className="grid grid-cols-5 gap-1 border-t border-white/5 p-2.5">{NOTCH_QUICK_LINKS.map((link) => { const Icon = QUICK_ICONS[link.icon]; return <button key={link.action} type="button" onClick={() => handleQuickAction(link.action)} className="flex flex-col items-center gap-1 rounded-lg py-1.5 text-neutral-400 hover:bg-white/5 hover:text-neutral-100"><Icon className="h-4 w-4" /><span className="text-[11px]">{link.label}</span></button>; })}</div>
    </>}
    {settingsOpen && <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-6"><div className="w-full rounded-xl border border-white/10 bg-[#27272a] p-4 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-medium">刘海激发器设置</h2><button type="button" onClick={() => setSettingsOpen(false)}><X className="h-4 w-4" /></button></div><label className="flex cursor-pointer items-center justify-between gap-4 text-xs text-neutral-300"><span>隐藏顶部激发器</span><input type="checkbox" checked={triggerHidden} onChange={(e) => setHidden(e.target.checked)} /></label><button type="button" onClick={() => openPath("/settings")} className="mt-4 text-xs text-sky-300">打开完整设置</button></div></div>}
  </div>;
}

function renderMemoContent(content: string) { return content.split(/(#[^\s#]+)/g).map((part, index) => !part.startsWith("#") || !parseMemoTags(part)[0] ? <span key={index}>{part}</span> : <span key={index} className="text-sky-300">{part}</span>); }
