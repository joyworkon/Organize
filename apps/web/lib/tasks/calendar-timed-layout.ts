import type { TaskWithTags } from "@organize/shared";
import {
  calendarDateOnly as dateOnly,
  calendarDayKey,
  getTaskDate,
  getTaskEnd as taskEnd,
  isSameCalendarDay as isSameDay,
} from "./calendar-agenda";
import { isSingleDayTimedSpan as isSingleDayTimed } from "./calendar-allday-layout";

/** 与全天行保持一致：日 / 周重叠簇最多三条可见泳道。 */
export const MAX_TIMED_LANES = 3;

export interface WeekTimedEvent {
  task: TaskWithTags;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

/** 单日定时事件布局：包含当天 24:00 右开边界，重叠的贪心分列。 */
export function layoutDayTimedEvents(
  tasks: TaskWithTags[],
  day: Date
): WeekTimedEvent[] {
  const dayTime = dateOnly(day).getTime();
  const plain: Array<Omit<WeekTimedEvent, "lane" | "lanes">> = [];
  for (const task of tasks) {
    const start = getTaskDate(task);
    if (!start || task.all_day) continue;
    const end = taskEnd(task);
    if (!end) continue;
    if (dateOnly(start).getTime() !== dayTime || !isSingleDayTimed(start, end)) {
      continue; // 跨天任务走全天条
    }
    const startMin = start.getHours() * 60 + start.getMinutes();
    const rawEndMin = isSameDay(start, end) ? (end.getHours() * 60 + end.getMinutes()) : 1440;
    const endMin = Math.max(startMin + 15, rawEndMin === startMin ? startMin + 60 : rawEndMin);
    plain.push({ task, startMin, endMin });
  }
  plain.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const result: WeekTimedEvent[] = [];
  let cluster: Array<Omit<WeekTimedEvent, "lanes"> & { _end: number }> = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = cluster.reduce((max, e) => Math.max(max, e.lane + 1), 0);
    for (const e of cluster) result.push({ ...e, lanes });
    cluster = [];
    clusterEnd = -1;
  };
  for (const ev of plain) {
    if (cluster.length > 0 && ev.startMin >= clusterEnd) flush();
    let lane = 0;
    while (cluster.some((e) => e.lane === lane && e._end > ev.startMin)) lane += 1;
    cluster.push({ ...ev, lane, _end: ev.endMin });
    clusterEnd = Math.max(clusterEnd, ev.endMin);
  }
  flush();
  return result;
}

export interface TimedOverflowCluster {
  dayKey: string;
  startMin: number;
  endMin: number;
  hiddenCount: number;
  /** 簇内全部任务，包含可见块；沿用时间布局顺序。 */
  tasks: TaskWithTags[];
}

/** 在原贪心分列之上按簇折叠；边界相接（end === start）不算重叠。 */
export function layoutDayTimedEventsWithOverflow(
  tasks: TaskWithTags[],
  day: Date,
  { maxLanes = MAX_TIMED_LANES, createdId }: { maxLanes?: number; createdId?: string | null } = {}
): { visible: WeekTimedEvent[]; overflowClusters: TimedOverflowCluster[] } {
  const events = layoutDayTimedEvents(tasks, day);
  const visible: WeekTimedEvent[] = [];
  const overflowClusters: TimedOverflowCluster[] = [];
  let cluster: WeekTimedEvent[] = [];
  let endMin = -1;
  const flush = () => {
    if (!cluster.length) return;
    const lanes = Math.min(cluster[0].lanes, maxLanes);
    // 交换整条泳道而非单个任务，保留同 lane 事件互不重叠的保证。
    const createdLane = cluster.find((event) => event.task.id === createdId)?.lane;
    if (createdLane !== undefined && createdLane >= maxLanes) {
      for (const event of cluster) {
        if (event.lane === createdLane) event.lane = maxLanes - 1;
        else if (event.lane === maxLanes - 1) event.lane = createdLane;
      }
    }
    const shown = cluster.filter((event) => event.lane < maxLanes);
    visible.push(...shown.map((event) => ({ ...event, lanes })));
    const hiddenCount = cluster.length - shown.length;
    if (hiddenCount > 0) {
      overflowClusters.push({
        dayKey: calendarDayKey(day), startMin: cluster[0].startMin, endMin,
        hiddenCount, tasks: cluster.map((event) => event.task),
      });
    }
    cluster = [];
    endMin = -1;
  };
  for (const event of events) {
    if (cluster.length && event.startMin >= endMin) flush();
    cluster.push(event);
    endMin = Math.max(endMin, event.endMin);
  }
  flush();
  return { visible, overflowClusters };
}
