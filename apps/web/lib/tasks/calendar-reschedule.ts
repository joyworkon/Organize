/**
 * 日历右键菜单「改期」快捷项的纯函数（今天 / 明天 / 下周第一天 / 清除日期）。
 *
 * 与月历拖拽改期（computeDragReschedule 按毫秒时长平移）不同，这里是整日移动：
 * 开始与结束各自按本地日历日平移同样的天数，保留本地墙钟的时分（跨夏令时
 * 也不会漂移一小时），全天任务仍是全天。清除日期把排期与截止一并置空，
 * 任务从日历消失但仍留在任务列表。
 */
import type { CalendarWeekStart } from "@/lib/tasks/calendar-view-options";
import { weekStartOf } from "@/lib/tasks/calendar-view-options";
import type { Task } from "@organize/shared";

export type CalendarRescheduleShortcut = "today" | "tomorrow" | "nextWeekStart" | "clear";

/** 传 task 的可空排期字段即可（TaskWithTags 满足）。 */
export interface CalendarRescheduleTaskFields {
  schedule_start_at?: string | null;
  schedule_end_at?: string | null;
  due_date?: string | null;
}

function dateOnlyShift(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days,
    base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
}

/** 快捷项的目标日（仅日期语义，无时刻）：今天 / 明天 /下周第一天（weekStart=1 周一、0 周日）。 */
export function rescheduleShortcutTarget(
  shortcut: Exclude<CalendarRescheduleShortcut, "clear">,
  now: Date,
  weekStart: CalendarWeekStart = 1
): Date {
  if (shortcut === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (shortcut === "tomorrow") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }
  const thisWeekStart = weekStartOf(now, weekStart);
  return new Date(thisWeekStart.getFullYear(), thisWeekStart.getMonth(), thisWeekStart.getDate() + 7);
}

/** 本地日历日差：target - base（按各自本地日期的午夜算）。 */
function localDayDiff(base: Date, target: Date): number {
  const a = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  const b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** 菜单第三项文案：跟随周起始日（默认「下周一」，周日起始时是「下周日」）。 */
export function nextWeekStartLabel(weekStart: CalendarWeekStart = 1): string {
  return weekStart === 0 ? "下周日" : "下周一";
}

/**
 * 生成快捷改期的更新补丁。
 * - today / tomorrow / nextWeekStart：以 schedule_start_at ?? due_date 为锚整段平移（无 end 则只移 start）。
 * - clear：schedule_start_at / schedule_end_at / due_date 全部置空。
 * 未排期任务对改期快捷项返回 null（调用方不该展示可用的改期项）。
 */
export function calendarReschedulePatch(
  task: CalendarRescheduleTaskFields,
  shortcut: CalendarRescheduleShortcut,
  now: Date,
  weekStart: CalendarWeekStart = 1
): Partial<Pick<Task, "schedule_start_at" | "schedule_end_at" | "due_date">> | null {
  if (shortcut === "clear") {
    return { schedule_start_at: null, schedule_end_at: null, due_date: null };
  }
  const anchorValue = task.schedule_start_at ?? task.due_date;
  if (!anchorValue) return null;
  const anchor = new Date(anchorValue);
  if (Number.isNaN(anchor.getTime())) return null;
  const target = rescheduleShortcutTarget(shortcut, now, weekStart);
  const days = localDayDiff(anchor, target);
  const nextStart = dateOnlyShift(anchor, days).toISOString();
  const end = task.schedule_end_at ? new Date(task.schedule_end_at) : null;
  // 与库端触发器同语义：due_date 跟随结束（无结束跟开始），调用方 updateTask 也会再归一。
  const nextEnd = end && !Number.isNaN(end.getTime()) ? dateOnlyShift(end, days).toISOString() : null;
  return {
    schedule_start_at: nextStart,
    schedule_end_at: nextEnd,
    due_date: nextEnd ?? nextStart,
  };
}
