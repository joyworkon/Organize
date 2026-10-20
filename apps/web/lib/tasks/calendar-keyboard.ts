/** 日历页翻页 / 回今天 / 切视图的按键匹配。组件用 useHotkey 注册，这里锁住修饰键与大小写规则。 */

export type CalendarNavAction = "prev" | "next" | "today" | "day" | "week" | "month" | "year";

export interface CalendarNavKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const LETTER_ACTIONS: Record<string, CalendarNavAction> = {
  t: "today",
  d: "day",
  w: "week",
  m: "month",
  y: "year",
};

/**
 * 单键日历导航。带 ⌘ / Ctrl / Alt 一律忽略；Shift+方向键忽略（不做选区）。
 * t/d/w/m/y 大小写不敏感，Shift+字母仍算该字母。
 */
export function matchCalendarNavKey(event: CalendarNavKeyEvent): CalendarNavAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (event.shiftKey) return null;
    return event.key === "ArrowLeft" ? "prev" : "next";
  }
  if (event.key.length !== 1) return null;
  return LETTER_ACTIONS[event.key.toLowerCase()] ?? null;
}

/**
 * 焦点在桌面月网格的格子内（含日期数字和「+N」）时，←/→ 只移动日期。
 * 页面级翻页必须让位，否则一次按键会同时翻月和移动焦点。
 * 任务条在格子外面，不在此列。
 */
export function isMonthGridCellEventTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined") return false;
  const element = target instanceof Element
    ? target
    : typeof Node !== "undefined" && target instanceof Node
      ? target.parentElement
      : null;
  if (!element) return false;
  const cell = element.closest("[role='gridcell']");
  return Boolean(cell?.closest("[data-calendar-surface='month']"));
}

export type CalendarSurfaceMode = "day" | "week" | "month" | "year";

/**
 * 切到日视图时应对齐的日期。
 * 日/周：以 selectedDate 为准。
 * 月/年：用户翻页只改了 cursor，把日号夹进 cursor 所在月（含月末，2 月按平/闰年）。
 */
export function dateForDayView(fromMode: CalendarSurfaceMode, cursor: Date, selectedDate: Date): Date {
  if (fromMode === "month" || fromMode === "year") {
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(selectedDate.getDate(), last));
  }
  return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
}
