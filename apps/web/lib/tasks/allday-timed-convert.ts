/**
 * 日/周时间网格「全天行 ↔ 时间网格」拖拽落点的日程计算（纯函数）。
 *
 * 规则按**拖起区域**而不是 task.all_day 判定：全天行里也会出现跨天的定时任务
 * （all_day=false），用户把它拖进某个小时槽位时要的就是一个定时块；同区拖拽则
 * 维持原有「不改 all_day、保持时长」的语义，保证已有改期行为不回归。
 */

/** 全天行（含跨天）与时间网格两块落点区域。 */
export type TimeGridZone = "all-day" | "timed";

/** 全天→定时的默认时长（分钟），与网格轻点新建的 1 小时一致。 */
export const ALLDAY_TO_TIMED_DEFAULT_MIN = 60;

const DAY_MINUTES = 1440;
const DAY_MS = 86400000;

export interface TimeGridDropInput {
  /** 原开始。 */
  start: Date;
  /** 原结束（没有结束时传开始）。 */
  end: Date;
  /** 原 all_day 标记；同区拖拽原样写回。 */
  allDay: boolean;
  /** 拖起区域。 */
  from: TimeGridZone;
  /** 落点区域。 */
  to: TimeGridZone;
  /** 落点日（本地日历日，时分忽略）。 */
  day: Date;
  /** 落点槽位（当天分钟数，已吸附）；落在全天行时忽略。 */
  slotMin: number;
}

export interface TimeGridDropResult {
  schedule_start_at: string;
  schedule_end_at: string;
  all_day: boolean;
}

function dateOnly(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function atMinutes(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
}

function isLocalMidnight(date: Date): boolean {
  return (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  );
}

/**
 * 日程覆盖的本地日历天数（至少 1）。结束恰在 00:00 视为前一日 24:00（右开区间），
 * 与网格判定单日定时事件的 isSingleDayTimed 一致；DST 23/25 小时的天按四舍五入。
 */
export function calendarSpanDays(start: Date, end: Date): number {
  const inclusiveEnd =
    end.getTime() > start.getTime() && isLocalMidnight(end) ? new Date(end.getTime() - 1) : end;
  const diff = Math.round((dateOnly(inclusiveEnd).getTime() - dateOnly(start).getTime()) / DAY_MS);
  return Math.max(1, diff + 1);
}

/**
 * 拖拽落点 → 新的 schedule 字段。
 * - 同区：all_day 不变，start 落到目标列（全天 00:00 / 定时槽位），end 保持原时长；
 * - 全天→定时：all_day=false，默认 60 分钟，夹在落点日 24:00 内（避免 end 跨到次日又掉回全天行）；
 * - 定时→全天：all_day=true，start = 落点日 00:00，end = 落点日 + (原跨越天数 − 1) 的 00:00
 *   （单日即 end === start，与现有全天芯片拖拽写回的形状一致）。
 */
export function computeTimeGridDrop({
  start,
  end,
  allDay,
  from,
  to,
  day,
  slotMin,
}: TimeGridDropInput): TimeGridDropResult {
  const safeEnd = end.getTime() >= start.getTime() ? end : start;

  if (from === to) {
    const nextStart = to === "all-day" ? dateOnly(day) : atMinutes(day, slotMin);
    const nextEnd = new Date(nextStart.getTime() + (safeEnd.getTime() - start.getTime()));
    return {
      schedule_start_at: nextStart.toISOString(),
      schedule_end_at: nextEnd.toISOString(),
      all_day: allDay,
    };
  }

  if (to === "timed") {
    const startMin = Math.max(0, Math.min(DAY_MINUTES - 1, slotMin));
    const endMin = Math.min(DAY_MINUTES, startMin + ALLDAY_TO_TIMED_DEFAULT_MIN);
    return {
      schedule_start_at: atMinutes(day, startMin).toISOString(),
      schedule_end_at: atMinutes(day, endMin).toISOString(),
      all_day: false,
    };
  }

  const nextStart = dateOnly(day);
  const nextEnd = new Date(
    nextStart.getFullYear(),
    nextStart.getMonth(),
    nextStart.getDate() + calendarSpanDays(start, safeEnd) - 1
  );
  return {
    schedule_start_at: nextStart.toISOString(),
    schedule_end_at: nextEnd.toISOString(),
    all_day: true,
  };
}
