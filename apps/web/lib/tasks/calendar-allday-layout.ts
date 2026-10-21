import type { TaskWithTags } from "@organize/shared";
import {
  calendarDateOnly as dateOnly,
  calendarDayDiff as dayDiff,
  getTaskDate,
  getTaskEnd as taskEnd,
  isSameCalendarDay,
} from "./calendar-agenda";

/**
 * 跨天任务连续条（spanning bar）的共享布局：月视图格与日/周时间网格全天行
 * 共用同一套切段 + 贪心泳道 + 折叠算法，避免两处实现漂移。
 * 全部按本地日期比较（不用时刻切断）：结束在次日零点的任务仍盖住次日。
 */

/** 泳道可见上限，超出的段折叠为每列 +N（月格弹层 / 全天行弹层）。 */
export const MAX_SPAN_LANES = 3;

export interface SpanSegment {
  task: TaskWithTags;
  /** 起始列（0 到 days.length-1，已夹到可见范围） */
  startCol: number;
  /** 结束列（含，已夹到可见范围） */
  endCol: number;
  /** 从可见范围之前延续进来（左端不闭合、不显示勾选框） */
  continuesBefore: boolean;
  /** 延续到可见范围之后（右端不闭合） */
  continuesAfter: boolean;
  /** 泳道序号（返回的可见段保证 < maxLanes） */
  lane: number;
}

function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * 单日定时事件判定：同日，或结束恰在次日 00:00（视为当日 24:00 右开边界）。
 * 与时间网格 layoutDayTimedEvents 同口径，用于区分「留在时间轴」与「上全天行」。
 */
export function isSingleDayTimedSpan(start: Date, end: Date): boolean {
  return (
    isSameCalendarDay(start, end) ||
    (end.getTime() > start.getTime() &&
      minutesSinceMidnight(end) === 0 &&
      end.getSeconds() === 0 &&
      end.getMilliseconds() === 0 &&
      isSameCalendarDay(start, new Date(end.getTime() - 1)))
  );
}

/** 全天行判定：全天任务，或跨天的定时任务（单日定时仍留在时间网格）。 */
export function isAllDayRowTask(task: TaskWithTags, start: Date, end: Date): boolean {
  if (task.all_day) return true;
  return !isSingleDayTimedSpan(start, end);
}

/** 全天行覆盖某天的全部任务（含折叠进 +N 的；弹层列表用），按 开始时刻 → sort_order → id 稳定排序。 */
export function allDayRowTasksOnDay(tasks: TaskWithTags[], day: Date): TaskWithTags[] {
  return tasks
    .filter((task) => {
      const start = getTaskDate(task);
      if (!start) return false;
      const end = taskEnd(task);
      if (!end) return false;
      if (!isAllDayRowTask(task, start, end)) return false;
      return dayDiff(dateOnly(start), day) <= 0 && dayDiff(dateOnly(end), day) >= 0;
    })
    .sort((a, b) => {
      const time = (getTaskDate(a)?.getTime() || 0) - (getTaskDate(b)?.getTime() || 0);
      return time || a.sort_order - b.sort_order || a.id.localeCompare(b.id);
    });
}

export interface SpanLayoutOptions {
  /** 只保留全天行任务（时间网格全天行）；false = 全部有排期任务（月视图格）。 */
  allDayRowOnly?: boolean;
  /** 可见泳道上限；缺省 MAX_SPAN_LANES。 */
  maxLanes?: number;
  /** 刚创建的任务若被折叠，临时换进可见泳道，让新建反馈不藏在 +N 后。 */
  createdId?: string | null;
}

/**
 * 把任务切到可见列并分配泳道。days 可以是整周 7 列、隐藏周末的 5 列工作日
 * 或单列日视图；从可见范围外延续进来 / 延出去的端不闭合（continuesBefore/After）。
 * 返回可见段（lane < maxLanes）与每列被折叠的任务数。
 */
export function layoutSpanSegments(
  tasks: TaskWithTags[],
  days: Date[],
  options: SpanLayoutOptions = {}
): { segments: SpanSegment[]; hiddenByCol: number[] } {
  const { allDayRowOnly = false, maxLanes = MAX_SPAN_LANES, createdId } = options;
  const cols = days.length;
  const rangeStart = dateOnly(days[0]);
  const rangeEnd = dateOnly(days[cols - 1]);

  const segs: SpanSegment[] = [];
  for (const task of tasks) {
    const start = getTaskDate(task);
    if (!start) continue;
    const end = taskEnd(task) || start;
    if (allDayRowOnly && !isAllDayRowTask(task, start, end)) continue;
    const taskStart = dateOnly(start);
    const taskFinish = dateOnly(end);
    if (taskFinish < rangeStart || taskStart > rangeEnd) continue;
    const startCol = Math.max(0, dayDiff(taskStart, rangeStart));
    const endCol = Math.min(cols - 1, dayDiff(taskFinish, rangeStart));
    // 起点在最后一个可见列之后（如周一开头隐藏周末时的周日单日任务）：本次不可见。
    if (startCol > cols - 1 || endCol < 0) continue;
    segs.push({
      task,
      startCol,
      endCol: Math.max(startCol, endCol),
      continuesBefore: taskStart < rangeStart,
      continuesAfter: taskFinish > rangeEnd,
      lane: 0,
    });
  }

  // 先按起始列、再按跨度降序排，贪心分配到第一个能放下的泳道
  segs.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));
  const laneEnds: number[] = [];
  for (const seg of segs) {
    let lane = laneEnds.findIndex((end) => end < seg.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(-1);
    }
    seg.lane = lane;
    laneEnds[lane] = seg.endCol;
  }

  // 拥挤时临时交换整条泳道，让刚创建的任务可见；重叠段仍各归其位，下次布局恢复正常。
  const createdLane = segs.find((seg) => seg.task.id === createdId)?.lane;
  if (createdLane !== undefined && createdLane >= maxLanes) {
    for (const seg of segs) {
      if (seg.lane === createdLane) seg.lane = maxLanes - 1;
      else if (seg.lane === maxLanes - 1) seg.lane = createdLane;
    }
  }

  const hiddenByCol = Array.from({ length: cols }, () => 0);
  const visible: SpanSegment[] = [];
  for (const seg of segs) {
    if (seg.lane < maxLanes) {
      visible.push(seg);
    } else {
      for (let col = seg.startCol; col <= seg.endCol; col += 1) hiddenByCol[col] += 1;
    }
  }
  return { segments: visible, hiddenByCol };
}
