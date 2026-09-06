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

/** K04：uuid 形态深链（/notes/<uuid>、/tasks?task=<uuid>）的校验——
 * 只放行合法 uuid，防注入；与 Rust 侧 OPEN_PATH 校验逻辑保持镜像。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNotchOpenPathAllowed(path: unknown): boolean {
  if (typeof path !== "string") return false;
  if (NOTCH_OPEN_PATHS.has(path)) return true;
  // /notes/<uuid>：新建笔记后「继续编辑」深链
  const noteMatch = /^\/notes\/([0-9a-f-]{36})$/.exec(path);
  if (noteMatch && UUID_RE.test(noteMatch[1])) return true;
  // /tasks?task=<uuid>：面板任务标题「打开详情」深链
  const taskMatch = /^\/tasks\?task=([0-9a-f-]{36})$/.exec(path);
  if (taskMatch && UUID_RE.test(taskMatch[1])) return true;
  return false;
}

/**
 * K03：跨 WebView 数据变更通知（Tauri 应用级事件广播）。
 * 不同 webview 不共享 window 事件总线；panel ↔ 主窗口的领域变更
 * 统一经 Rust 桥转发为 organize-data-changed。origin 用于发送方跳过自己的回声。
 */
export type NotchDataTopic = "memos" | "tasks" | "notes";

export interface NotchDataChangedPayload {
  topic: NotchDataTopic;
  origin: "notch-panel" | "main";
}

export async function emitDataChanged(payload: NotchDataChangedPayload): Promise<void> {
  if (typeof window === "undefined") return;
  // Tauri 事件走 Rust；纯 web 下退化为 window 事件（同窗口仍有意义）
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("notch-data-changed", payload);
      return;
    } catch {
      // fallthrough to window event
    }
  }
  window.dispatchEvent(new CustomEvent("organize-data-changed", { detail: payload }));
}

export async function subscribeDataChanged(
  handler: (payload: NotchDataChangedPayload) => void
): Promise<() => void> {
  if (typeof window === "undefined") return () => {};
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<NotchDataChangedPayload>("organize-data-changed", (event) => {
        handler(event.payload);
      });
      return unlisten;
    } catch {
      // fallthrough to window event
    }
  }
  const windowHandler = (event: Event) => {
    const detail = (event as CustomEvent<NotchDataChangedPayload>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener("organize-data-changed", windowHandler);
  return () => window.removeEventListener("organize-data-changed", windowHandler);
}

/** K01：面板活动心跳（输入/输入法组合/保存中），Rust 侧顺延忙碌计时阻止自动收起 */
export async function emitNotchActivity(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("notch-activity", {});
  } catch {
    // 忽略：活动上报失败只影响自动收起时机，不影响功能
  }
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
