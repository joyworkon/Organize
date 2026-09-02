/**
 * 刘海激发器（notch-trigger-plan）共享纯逻辑：
 * Rust 侧 notch-trigger / notch-panel 两窗口加载同一个 `/desktop/notch` 页面，
 * 按窗口 label 分角色；这里集中角色判定、面板数据筛选与跳转白名单，
 * 供页面组件与单测共用（不做任何副作用）。
 */
import type { Memo, Task } from "@organize/shared";

/** 「隐藏激发器」开关的 localStorage 键（主窗口设置页与胶囊窗口共享同源存储） */
export const NOTCH_TRIGGER_HIDDEN_KEY = "organize.notch-trigger-hidden";

export function readNotchTriggerHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NOTCH_TRIGGER_HIDDEN_KEY) === "1";
  } catch {
    // localStorage 不可用时按可见处理（开关是可选的打磨项，不阻塞胶囊）
    return false;
  }
}

export type NotchWindowRole = "trigger" | "panel" | "demo";

/** Tauri 窗口 label → 页面角色；非 notch 窗口（含普通浏览器）为演示态 */
export function notchRoleFromLabel(label: string | null | undefined): NotchWindowRole {
  if (label === "notch-trigger") return "trigger";
  if (label === "notch-panel") return "panel";
  return "demo";
}

export interface NotchQuickLink {
  icon: "zap" | "book" | "note" | "todo" | "settings";
  label: string;
  path: string;
}

/** 面板底部快速入口（⚡速记 = 打开主窗口 /memos） */
export const NOTCH_QUICK_LINKS: readonly NotchQuickLink[] = [
  { icon: "zap", label: "速记", path: "/memos" },
  { icon: "book", label: "稍后读", path: "/library" },
  { icon: "note", label: "笔记", path: "/notes" },
  { icon: "todo", label: "待办", path: "/tasks" },
  { icon: "settings", label: "设置", path: "/settings" },
];

/**
 * 快速入口跳转白名单（含未登录态的 /login）。
 * Rust 侧 `notch-open-path` 处理器镜像同一份清单；主窗口接收端另有
 * sanitizeNavigatePath 兜底，这里是第一道闸。
 */
const NOTCH_OPEN_PATHS: ReadonlySet<string> = new Set([
  ...NOTCH_QUICK_LINKS.map((link) => link.path),
  "/login",
]);

export function isNotchOpenPathAllowed(path: unknown): boolean {
  return typeof path === "string" && NOTCH_OPEN_PATHS.has(path);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * 面板「今日待办」：对齐 /tasks 工作台 today scope 语义——
 * 今天到期或已逾期（早于今天 00:00）、未完成、未删除、非子任务，置顶优先、
 * 日期近的在前，最多 3 条。
 */
export function selectPanelTasks(
  tasks: Task[],
  now: Date = new Date()
): Task[] {
  const todayStart = startOfDay(now);
  return tasks
    .filter((task) => !task.deleted_at && task.parent_task_id == null)
    .filter((task) => task.status !== "done" && task.status !== "cancelled")
    .filter((task) => {
      const value = task.schedule_start_at || task.due_date;
      if (!value) return false;
      const time = new Date(value).getTime();
      if (Number.isNaN(time)) return false;
      // 今天到期，或已逾期（早于今天 00:00）
      return new Date(value).toDateString() === now.toDateString() || time < todayStart;
    })
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      const av = new Date(a.schedule_start_at || a.due_date || "").getTime();
      const bv = new Date(b.schedule_start_at || b.due_date || "").getTime();
      return av - bv;
    })
    .slice(0, 3);
}

/**
 * 保存成功后的乐观回显：新速记插到顶部、按 id 去重、截断到 limit 条。
 */
export function insertMemoOptimistic(list: Memo[], memo: Memo, limit = 3): Memo[] {
  return [memo, ...list.filter((item) => item.id !== memo.id)].slice(0, limit);
}

/** 最近速记的时间标签：今天显示 HH:mm，更早显示 M月d日 */
export function memoTimeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (startOfDay(date) === startOfDay(now)) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
