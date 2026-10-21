import type { TaskWithTags } from "@organize/shared";
import { getMonthCells } from "./calendar-agenda";

/**
 * 日历「显示」选项：已完成任务 / 倒数日可见性、周起始日、周末列。
 * 默认值与历史行为一致（全显示、周一起始），老用户首屏不变。
 * 选项按用户持久化到 localStorage；读写都是纯函数，便于单测。
 */

/** 0 = 周日起始，1 = 周一起始 */
export type CalendarWeekStart = 0 | 1;

export interface CalendarViewOptions {
  showCompleted: boolean;
  showCountdowns: boolean;
  weekStart: CalendarWeekStart;
  showWeekends: boolean;
}

export const DEFAULT_CALENDAR_VIEW_OPTIONS: CalendarViewOptions = {
  showCompleted: true,
  showCountdowns: true,
  weekStart: 1,
  showWeekends: true,
};

const STORAGE_PREFIX = "organize:calendar-view-options:";

export function calendarViewOptionsStorageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? "anonymous"}`;
}

/** 解析并校验存储值；缺字段回落默认值，非法整体作废。 */
export function parseCalendarViewOptions(raw: string | null): CalendarViewOptions | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = parsed as Partial<CalendarViewOptions>;
  if (
    (value.showCompleted !== undefined && typeof value.showCompleted !== "boolean") ||
    (value.showCountdowns !== undefined && typeof value.showCountdowns !== "boolean") ||
    (value.showWeekends !== undefined && typeof value.showWeekends !== "boolean") ||
    (value.weekStart !== undefined && value.weekStart !== 0 && value.weekStart !== 1)
  ) {
    return null;
  }
  return {
    showCompleted: value.showCompleted ?? DEFAULT_CALENDAR_VIEW_OPTIONS.showCompleted,
    showCountdowns: value.showCountdowns ?? DEFAULT_CALENDAR_VIEW_OPTIONS.showCountdowns,
    weekStart: value.weekStart ?? DEFAULT_CALENDAR_VIEW_OPTIONS.weekStart,
    showWeekends: value.showWeekends ?? DEFAULT_CALENDAR_VIEW_OPTIONS.showWeekends,
  };
}

export function loadCalendarViewOptions(storage: Pick<Storage, "getItem"> | null, userId: string | null): CalendarViewOptions {
  if (!storage) return { ...DEFAULT_CALENDAR_VIEW_OPTIONS };
  try {
    return parseCalendarViewOptions(storage.getItem(calendarViewOptionsStorageKey(userId))) ?? { ...DEFAULT_CALENDAR_VIEW_OPTIONS };
  } catch {
    return { ...DEFAULT_CALENDAR_VIEW_OPTIONS };
  }
}

export function saveCalendarViewOptions(
  storage: Pick<Storage, "setItem"> | null,
  userId: string | null,
  options: CalendarViewOptions
): void {
  if (!storage) return;
  try {
    storage.setItem(calendarViewOptionsStorageKey(userId), JSON.stringify(options));
  } catch {
    // 隐私模式 / 配额满：静默失败，本次会话内选项仍生效。
  }
}

/* ------------------------------ 日期计算 ------------------------------ */

export function isWeekendDay(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** date 所在周的起始日（weekStart=1 即历史 mondayOf）。 */
export function weekStartOf(date: Date, weekStart: CalendarWeekStart): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() - weekStart + 7) % 7));
  return d;
}

/** 周内列数：隐藏周末时 5 列工作日。 */
export function calendarColumnCount(showWeekends: boolean): 5 | 7 {
  return showWeekends ? 7 : 5;
}

/**
 * 当前显示选项下的 42/30 格月网格：先按周起始日生成整周，
 * 隐藏周末时按行保留前 5 列（周一起始 = 周一–周五，周日起始 = 周日–周四）。
 * 行边界始终对齐周。
 */
export function monthCellsForView(
  cursor: Date,
  weekStart: CalendarWeekStart,
  showWeekends: boolean
): { date: Date; inMonth: boolean }[] {
  const cells = getMonthCells(cursor, weekStart);
  if (showWeekends) return cells;
  const result: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    result.push(...cells.slice(i, i + 5));
  }
  return result;
}

/** 周视图可见列：隐藏周末时保留整周的前 5 天（与月网格同一口径）。 */
export function visibleWeekDays(days: Date[], showWeekends: boolean): Date[] {
  return showWeekends ? days : days.slice(0, 5);
}

/* ------------------------------ 数据过滤 ------------------------------ */

/** 隐藏已完成时过滤掉 done 任务；重复投影继承源状态，过滤口径一致。 */
export function filterCalendarTasks(tasks: TaskWithTags[], options: Pick<CalendarViewOptions, "showCompleted">): TaskWithTags[] {
  if (options.showCompleted) return tasks;
  return tasks.filter((task) => task.status !== "done");
}
