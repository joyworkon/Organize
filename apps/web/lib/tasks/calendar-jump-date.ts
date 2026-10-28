import { calendarDateOnly } from "./calendar-agenda";
import { weekStartOf, type CalendarWeekStart } from "./calendar-view-options";

/** 日历五模式（与 TaskMonthView 的 CalendarMode 同集合；独立定义避免 lib 反向依赖组件） */
export type CalendarJumpMode = "day" | "week" | "month" | "year" | "agenda";

export interface CalendarJumpTarget {
  /** 跳转后的视图：年视图选日后直接进入该日的日视图 */
  mode: CalendarJumpMode;
  /** 目标视图的 cursor（月视图对齐当月 1 日，周视图对齐到周起始日） */
  cursor: Date;
  /** 选中的具体日 */
  selected: Date;
}

/**
 * 「跳转到日期」把目标日映射为各模式的 cursor/selected 落点：
 * - 日视图 → 那天（cursor 对齐当月 1 日，与 step 翻页同一口径）
 * - 周视图 → 含该日的那一周（cursor = 周起始日，selectedDate 落在可见周内，同 M06）
 * - 月视图 → 该月并选中该日
 * - 年视图 → 打开该日的日视图
 * - 日程视图 → 以该日为起点的 30 天窗口（滚到该日分组由视图层处理）
 */
export function jumpTargetForDate(
  mode: CalendarJumpMode,
  date: Date,
  weekStart: CalendarWeekStart
): CalendarJumpTarget {
  const day = calendarDateOnly(date);
  const monthCursor = new Date(day.getFullYear(), day.getMonth(), 1);
  if (mode === "year") return { mode: "day", cursor: monthCursor, selected: day };
  if (mode === "week") return { mode: "week", cursor: weekStartOf(day, weekStart), selected: day };
  if (mode === "agenda") return { mode: "agenda", cursor: day, selected: day };
  return { mode, cursor: monthCursor, selected: day };
}
