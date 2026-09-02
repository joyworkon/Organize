import type { Memo, Task } from "@organize/shared";

export const NOTCH_TRIGGER_HIDDEN_KEY = "organize.notch-trigger-hidden";

export function readNotchTriggerHidden(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NOTCH_TRIGGER_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export type NotchWindowRole = "trigger" | "panel" | "demo";

export function notchRoleFromLabel(label: string | null | undefined): NotchWindowRole {
  if (/^notch-trigger-\d+$/.test(label ?? "")) return "trigger";
  if (label === "notch-panel") return "panel";
  return "demo";
}

export type NotchQuickAction = "focus-memo" | "add-reading" | "add-note" | "add-task" | "open-settings-modal";

export interface NotchQuickLink {
  icon: "zap" | "book" | "note" | "todo" | "settings";
  label: string;
  action: NotchQuickAction;
}

/** 刘海面板的五个就地操作；它们不唤起主窗口。 */
export const NOTCH_QUICK_LINKS: readonly NotchQuickLink[] = [
  { icon: "zap", label: "速记", action: "focus-memo" },
  { icon: "book", label: "稍后读", action: "add-reading" },
  { icon: "note", label: "笔记", action: "add-note" },
  { icon: "todo", label: "待办", action: "add-task" },
  { icon: "settings", label: "设置", action: "open-settings-modal" },
];

/** 保留既有导航白名单给未登录、更多设置与后续显式“在主窗口打开”入口使用。 */
const NOTCH_OPEN_PATHS: ReadonlySet<string> = new Set(["/memos", "/library", "/notes", "/tasks", "/settings", "/login"]);

export function isNotchOpenPathAllowed(path: unknown): boolean {
  return typeof path === "string" && NOTCH_OPEN_PATHS.has(path);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function selectPanelTasks(tasks: Task[], now: Date = new Date()): Task[] {
  const todayStart = startOfDay(now);
  return tasks
    .filter((task) => !task.deleted_at && task.parent_task_id == null)
    .filter((task) => task.status !== "done" && task.status !== "cancelled")
    .filter((task) => {
      const value = task.schedule_start_at || task.due_date;
      if (!value) return false;
      const time = new Date(value).getTime();
      if (Number.isNaN(time)) return false;
      return new Date(value).toDateString() === now.toDateString() || time < todayStart;
    })
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return new Date(a.schedule_start_at || a.due_date || "").getTime() - new Date(b.schedule_start_at || b.due_date || "").getTime();
    })
    .slice(0, 3);
}

export function insertMemoOptimistic(list: Memo[], memo: Memo, limit = 3): Memo[] {
  return [memo, ...list.filter((item) => item.id !== memo.id)].slice(0, limit);
}

export function memoTimeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (startOfDay(date) === startOfDay(now)) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
