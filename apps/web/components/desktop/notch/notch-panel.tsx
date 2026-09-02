"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  FileText,
  ListTodo,
  Loader2,
  LogIn,
  Settings,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { applyTaskUpdate } from "@/lib/tasks/atomic-update";
import { generateNextRecurringTask } from "@/lib/tasks/recurring";
import { getPlatform } from "@/lib/platform/detect";
import { parseMemoTags } from "@/lib/memos/tags";
import {
  insertMemoOptimistic,
  isNotchOpenPathAllowed,
  memoTimeLabel,
  NOTCH_QUICK_LINKS,
  selectPanelTasks,
} from "@/lib/desktop/notch";
import { cn } from "@/lib/utils";
import type { Memo, Task } from "@organize/shared";

const QUICK_ICONS = {
  zap: Zap,
  book: BookOpen,
  note: FileText,
  todo: ListTodo,
  settings: Settings,
} as const;

/** 收起动画时长（与 globals.css 的 notch-panel-out 对齐，见方案默认值 1） */
const EXIT_ANIMATION_MS = 120;

/**
 * 刘海面板（notch-panel 窗口，380×520）：速记输入 + 今日待办 + 最近速记 +
 * 快速入口。展开/收起由 Rust 管（hover 停留 150ms 展示、失焦 120ms 宽限收起、
 * ⌘⇧M toggle）；这里负责 Esc / 保存成功后先播收起动画再 emit notch-collapse，
 * 以及保存失败红字提示（内容不清空）。数据链路零新后端：
 * POST/GET /api/memos、tasks 直查 + update_task_atomic 原子勾选。
 */
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const exitingRef = useRef(false);

  const refreshData = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setLoggedIn(Boolean(user));
    if (!user) return;

    void (async () => {
      try {
        const res = await fetch("/api/memos?limit=3", { cache: "no-store" });
        if (res.ok) setMemos(((await res.json()) as Memo[]).slice(0, 3));
      } catch {
        // 静默：失败保留旧列表
      }
    })();

    setLoadingTasks(true);
    try {
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .order("is_pinned", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      setTasks((data || []) as Task[]);
    } catch {
      // 静默：失败保留旧列表
    } finally {
      setLoadingTasks(false);
    }
  }, [supabase]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  // Rust 每次展开都会 emit notch-panel-shown：重放入场动画 + 刷新数据 + 聚焦输入框
  useEffect(() => {
    if (getPlatform() !== "tauri") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("notch-panel-shown", () => {
          if (exitingRef.current) return;
          setExiting(false);
          setShownKey((key) => key + 1);
          void refreshData();
          requestAnimationFrame(() => textareaRef.current?.focus());
        }),
      )
      .then((fn) => {
        if (cancelled) fn?.();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshData]);

  /** 先播 120ms 收起动画再让 Rust 隐藏窗口（Esc / 保存成功共用） */
  const requestCollapse = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    setTimeout(() => {
      void import("@tauri-apps/api/event").then(({ emit }) => emit("notch-collapse"));
      exitingRef.current = false;
    }, EXIT_ANIMATION_MS);
  }, []);

  const openPath = useCallback((path: string) => {
    if (!isNotchOpenPathAllowed(path)) return;
    void import("@tauri-apps/api/event").then(({ emit }) => emit("notch-open-path", path));
  }, []);

  const save = useCallback(async () => {
    const content = input.trim();
    if (!content || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const memo = (await res.json()) as Memo;
      setMemos((list) => insertMemoOptimistic(list, memo));
      setInput("");
      setSavedFlash(true);
      setTimeout(() => {
        setSavedFlash(false);
        requestCollapse();
      }, 500);
    } catch {
      // 方案默认值 8：失败时输入内容保留在 textarea，红字提示
      setSaveError("保存失败，请检查网络后重试");
    } finally {
      setSaving(false);
    }
  }, [input, saving, requestCollapse]);

  const toggleTask = useCallback(
    async (task: Task) => {
      const patch = { status: "done", completed_at: new Date().toISOString() };
      setTasks((cur) => cur.filter((item) => item.id !== task.id));
      setTaskError(null);
      const result = await applyTaskUpdate(
        supabase,
        task.id,
        patch,
        task.sync_version ?? null,
        crypto.randomUUID(),
      );
      if (result.status === "applied" || result.status === "already_applied") {
        // 重复任务：与任务工作台一致，done 时幂等生成下一次
        const nextId = await generateNextRecurringTask(supabase, task.id);
        if (nextId) void refreshData();
      } else {
        setTaskError("勾选失败，请稍后重试");
        void refreshData();
      }
    },
    [supabase, refreshData],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      requestCollapse();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void save();
    }
  }

  const panelTasks = useMemo(() => selectPanelTasks(tasks), [tasks]);

  return (
    <div
      key={shownKey}
      className={cn(
        "notch-panel-in flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-black/60 bg-[#1d1d1f]/95 text-neutral-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl",
        exiting && "notch-panel-out",
      )}
    >
      {/* 速记输入区 */}
      <div className="border-b border-white/5 p-3.5">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (saveError) setSaveError(null);
            }}
            onKeyDown={onKeyDown}
            autoFocus
            rows={3}
            placeholder="记点什么… Enter 保存，Shift+Enter 换行"
            className="h-[96px] w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-relaxed text-neutral-100 placeholder:text-neutral-500 focus:border-white/25 focus:outline-none"
          />
          {savedFlash && (
            <span className="absolute right-2.5 top-2.5 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[11px] text-emerald-300">
              已保存 ✓
            </span>
          )}
        </div>
        <div className="mt-1.5 flex h-4 items-center justify-between px-1">
          <span className="text-[11px] text-neutral-500">#标签 会自动归档</span>
          {saveError ? (
            <span className="text-[11px] text-red-400">{saveError}</span>
          ) : (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!input.trim() || saving}
              className="flex items-center gap-1 text-[11px] text-neutral-400 transition-colors hover:text-neutral-100 disabled:opacity-40"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              保存
            </button>
          )}
        </div>
      </div>

      {loggedIn === false ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Zap className="h-6 w-6 text-neutral-500" />
          <p className="text-sm text-neutral-300">登录后可用</p>
          <button
            type="button"
            onClick={() => openPath("/login")}
            className="mt-1 flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-neutral-100 transition-colors hover:bg-white/20"
          >
            <LogIn className="h-3.5 w-3.5" />
            去登录
          </button>
        </div>
      ) : (
        <>
          {/* 今日待办 */}
          <div className="flex h-[128px] flex-col border-b border-white/5 px-3.5 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-medium text-neutral-400">今日待办</h3>
              {taskError && <span className="text-[11px] text-red-400">{taskError}</span>}
            </div>
            <div className="flex-1 space-y-1 overflow-hidden">
              {panelTasks.length === 0 ? (
                <p className="pt-3 text-center text-xs text-neutral-500">
                  {loadingTasks ? "加载中…" : "今天没有待办 ✨"}
                </p>
              ) : (
                panelTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => void toggleTask(task)}
                    title={task.title}
                    className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/5"
                  >
                    <span className="flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border border-white/25 transition-colors hover:border-white/50">
                      <Check className="h-3 w-3 text-transparent" />
                    </span>
                    <span className="truncate text-[13px] text-neutral-200">{task.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 最近速记 */}
          <div className="flex flex-1 flex-col overflow-hidden px-3.5 py-2.5">
            <h3 className="mb-1.5 text-xs font-medium text-neutral-400">最近速记</h3>
            <div className="flex-1 space-y-1.5 overflow-y-auto">
              {memos.length === 0 ? (
                <p className="pt-3 text-center text-xs text-neutral-500">还没有速记</p>
              ) : (
                memos.map((memo) => (
                  <div key={memo.id} className="flex gap-2 rounded-lg px-1.5 py-1 text-[12px] leading-relaxed">
                    <span className="flex-none pt-px text-[10px] text-neutral-500">
                      {memoTimeLabel(memo.created_at)}
                    </span>
                    <p className="line-clamp-2 text-neutral-300">{renderMemoContent(memo.content)}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 快速入口 */}
          <div className="grid grid-cols-5 gap-1 border-t border-white/5 p-2.5">
            {NOTCH_QUICK_LINKS.map((link) => {
              const Icon = QUICK_ICONS[link.icon];
              return (
                <button
                  key={link.path}
                  type="button"
                  onClick={() => openPath(link.path)}
                  className="flex flex-col items-center gap-1 rounded-lg py-1.5 text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-100"
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-[11px]">{link.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** 最近速记的 #标签 高亮（对齐 /memos 页 renderContent，此处不可点） */
function renderMemoContent(content: string) {
  return content.split(/(#[^\s#]+)/g).map((part, index) => {
    if (!part.startsWith("#") || !parseMemoTags(part)[0]) return <span key={index}>{part}</span>;
    return (
      <span key={index} className="text-sky-300">
        {part}
      </span>
    );
  });
}
