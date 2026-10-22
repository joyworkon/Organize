/**
 * 日历「未排期任务托盘」的纯函数：筛选 / 排序 / 搜索、拖拽落点 → 排期补丁、
 * 落点命中计算（月格 / 日周时间格）与托盘开关的 localStorage 持久化。
 *
 * 托盘口径：当前用户未删除、未完成（todo / in_progress）、既无 schedule_start_at
 * 也无 due_date、且非重复任务。注意 fetchTaskWorkspace 会把 due_date 并进
 * schedule_start_at，两者只要有一个非空任务就会出现在日历上，不会进托盘。
 */
import { ALLDAY_TO_TIMED_DEFAULT_MIN } from "@/lib/tasks/allday-timed-convert";
import type { Task, TaskWithTags } from "@organize/shared";

/** 拖拽落点：全天（月格 / 日周全天行）或定时（日周时间格槽位）。 */
export type UnscheduledDropTarget =
  | { zone: "all-day"; date: Date }
  | { zone: "timed"; date: Date; slotMin: number };

/** 页面 → 视图的拖拽会话快照：托盘条目持有 pointer capture，坐标由页面转发。 */
export interface CalendarUnscheduledDragState {
  task: TaskWithTags;
  clientX: number;
  clientY: number;
  /** 位移超过阈值后才产生落点与预览（与既有拖拽的 moved 语义一致）。 */
  moved: boolean;
}

/** 未完成且完全未排期（含非重复、未删除）的任务才进托盘。 */
export function isUnscheduledTask(task: TaskWithTags): boolean {
  return (
    !task.deleted_at &&
    (task.status === "todo" || task.status === "in_progress") &&
    !task.schedule_start_at &&
    !task.due_date &&
    !task.recurrence_rule
  );
}

/** 与工作台一致的展示顺序：置顶优先 → sort_order → 创建时间倒序 → id 倒序。 */
export function compareUnscheduledTasks(a: TaskWithTags, b: TaskWithTags): number {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/** 托盘列表：筛选 + 标题搜索（大小写不敏感包含）+ 既有排序规则。 */
export function filterUnscheduledTasks(
  tasks: TaskWithTags[],
  query = ""
): TaskWithTags[] {
  const normalized = query.trim().toLocaleLowerCase();
  return tasks
    .filter(isUnscheduledTask)
    .filter((task) => !normalized || task.title.toLocaleLowerCase().includes(normalized))
    .sort(compareUnscheduledTasks);
}

/**
 * 落点 → 排期补丁。
 * - 全天：start 当日 00:00、end 置空、all_day=true（与快速新建的全天形状一致）；
 * - 定时：start 吸附槽位、时长用全天⇄定时互转的同一默认常量（60 分钟）、all_day=false。
 */
export function unscheduledDropPatch(target: UnscheduledDropTarget): Partial<Task> {
  if (target.zone === "all-day") {
    const start = new Date(
      target.date.getFullYear(),
      target.date.getMonth(),
      target.date.getDate()
    );
    return {
      schedule_start_at: start.toISOString(),
      schedule_end_at: null,
      due_date: start.toISOString(),
      all_day: true,
    };
  }
  const start = new Date(
    target.date.getFullYear(),
    target.date.getMonth(),
    target.date.getDate(),
    0,
    target.slotMin
  );
  const end = new Date(start.getTime() + ALLDAY_TO_TIMED_DEFAULT_MIN * 60_000);
  return {
    schedule_start_at: start.toISOString(),
    schedule_end_at: end.toISOString(),
    due_date: end.toISOString(),
    all_day: false,
  };
}

function formatDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatTime(hourMinute: number): string {
  return `${String(Math.floor(hourMinute / 60)).padStart(2, "0")}:${String(hourMinute % 60).padStart(2, "0")}`;
}

/** 拖入排期 / 快捷排期的 toast 标题：`已排到 10月24日` / `已排到 10月24日 14:00`。 */
export function unscheduledDropLabel(target: UnscheduledDropTarget): string {
  if (target.zone === "all-day") return `已排到 ${formatDay(target.date)}`;
  return `已排到 ${formatDay(target.date)} ${formatTime(target.slotMin)}`;
}

/** 撤销要恢复的排期字段快照（托盘任务全为 null，但保持通用形状）。 */
export interface ScheduleUndoSnapshot {
  schedule_start_at: string | null;
  schedule_end_at: string | null;
  due_date: string | null;
  all_day: boolean;
}

export function scheduleUndoSnapshot(task: TaskWithTags): ScheduleUndoSnapshot {
  return {
    schedule_start_at: task.schedule_start_at ?? null,
    schedule_end_at: task.schedule_end_at ?? null,
    due_date: task.due_date ?? null,
    all_day: Boolean(task.all_day),
  };
}

export interface ScheduleChangeFields {
  schedule_start_at?: string | null;
  schedule_end_at?: string | null;
  all_day?: boolean | null;
}

/**
 * 日程更新前后的 toast 标题（拖动改期 / 调时长 / 全天⇄定时互转 / 清除日期共用）：
 * - all_day 翻转 → 已转为全天任务 / 已转为定时任务；
 * - 日期变化 → 已改期到 10月25日（定时补 HH:MM）；
 * - 仅时长或当天时刻变化 → 已调整时长 / 已改期到 10月21日 14:00；
 * - start 清空 → 已从日历移除（与右键菜单「清除日期」同文案）。
 * 无可见变化返回 null（不弹 toast）。
 */
export function scheduleChangeLabel(
  before: ScheduleChangeFields,
  after: ScheduleChangeFields
): string | null {
  const nextStart = after.schedule_start_at ? new Date(after.schedule_start_at) : null;
  const prevStart = before.schedule_start_at ? new Date(before.schedule_start_at) : null;
  if (!nextStart) return prevStart ? "已从日历移除" : null;
  if (!prevStart) return `已排到 ${formatDay(nextStart)}`;
  const nextAllDay = after.all_day ?? false;
  const prevAllDay = before.all_day ?? false;
  if (nextAllDay !== prevAllDay) return nextAllDay ? "已转为全天任务" : "已转为定时任务";
  const dayChanged =
    nextStart.getFullYear() !== prevStart.getFullYear() ||
    nextStart.getMonth() !== prevStart.getMonth() ||
    nextStart.getDate() !== prevStart.getDate();
  if (dayChanged) {
    return nextAllDay
      ? `已改期到 ${formatDay(nextStart)}`
      : `已改期到 ${formatDay(nextStart)} ${formatTime(nextStart.getHours() * 60 + nextStart.getMinutes())}`;
  }
  const nextEnd = after.schedule_end_at ? new Date(after.schedule_end_at).getTime() : null;
  const prevEnd = before.schedule_end_at ? new Date(before.schedule_end_at).getTime() : null;
  const durationChanged =
    nextEnd !== prevEnd &&
    nextStart.getTime() - prevStart.getTime() === 0;
  if (durationChanged) return "已调整时长";
  const timeChanged =
    nextStart.getHours() !== prevStart.getHours() ||
    nextStart.getMinutes() !== prevStart.getMinutes();
  if (timeChanged) {
    return `已改期到 ${formatDay(nextStart)} ${formatTime(nextStart.getHours() * 60 + nextStart.getMinutes())}`;
  }
  return null;
}

/* ------------------------- 落点命中（纯几何） ------------------------- */

/** 月格落点：指针在月网格内时按周行矩形 + 列换算目标日；网格外返回 null。 */
export function resolveMonthDropTarget(params: {
  gridRect: DOMRect | null;
  rowRects: (DOMRect | null)[];
  weeks: Date[][];
  colCount: number;
  clientX: number;
  clientY: number;
}): Date | null {
  const { gridRect, rowRects, weeks, colCount, clientX, clientY } = params;
  if (!gridRect || gridRect.width <= 0 || gridRect.height <= 0) return null;
  if (clientY < gridRect.top || clientY >= gridRect.bottom) return null;
  if (clientX < gridRect.left || clientX >= gridRect.right) return null;
  for (let i = 0; i < weeks.length; i += 1) {
    const rect = rowRects[i];
    if (!rect || rect.width <= 0 || clientY < rect.top || clientY >= rect.bottom) continue;
    const col = Math.min(
      colCount - 1,
      Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * colCount))
    );
    return weeks[i][col] ?? null;
  }
  return null;
}

/** 日周时间格落点：全天行（含表头带）或时间网格内按列 + 吸附槽位；容器外返回 null。 */
export function resolveTimeGridDropTarget(params: {
  surfaceRect: DOMRect | null;
  allDayRect: DOMRect | null;
  gridRect: DOMRect | null;
  /** 网格滚动容器的当前 scrollTop（落点换算要含滚出可视区的部分）。 */
  gridScrollTop?: number;
  gutterWidth: number;
  /** 每小时的像素高度（与时间网格 HOUR_HEIGHT 一致）。 */
  hourHeight: number;
  days: Date[];
  snapMin?: number;
  clientX: number;
  clientY: number;
}): UnscheduledDropTarget | null {
  const { surfaceRect, allDayRect, gridRect, gutterWidth, hourHeight, days, clientX, clientY } = params;
  const snapMin = params.snapMin ?? 30;
  if (!surfaceRect || surfaceRect.width <= 0 || surfaceRect.height <= 0) return null;
  if (
    clientX < surfaceRect.left ||
    clientX >= surfaceRect.right ||
    clientY < surfaceRect.top ||
    clientY >= surfaceRect.bottom
  ) {
    return null;
  }
  const dayIndex = (rect: DOMRect) =>
    Math.min(
      days.length - 1,
      Math.max(
        0,
        Math.floor(((clientX - rect.left - gutterWidth) / Math.max(1, rect.width - gutterWidth)) * days.length)
      )
    );
  if (allDayRect && clientY >= allDayRect.top && clientY < allDayRect.bottom) {
    return { zone: "all-day", date: days[dayIndex(allDayRect)] };
  }
  if (gridRect && gridRect.height > 0 && clientY >= gridRect.top && clientY < gridRect.bottom) {
    const minutes = ((clientY - gridRect.top + (params.gridScrollTop ?? 0)) / hourHeight) * 60;
    const slot = Math.max(0, Math.min(1440 - snapMin, Math.round(minutes / snapMin) * snapMin));
    return { zone: "timed", date: days[dayIndex(gridRect)], slotMin: slot };
  }
  return null;
}

/* ------------------------- 托盘开关持久化 ------------------------- */

const TRAY_STORAGE_PREFIX = "organize:calendar-unscheduled-tray:";

export function unscheduledTrayStorageKey(userId: string | null): string {
  return `${TRAY_STORAGE_PREFIX}${userId ?? "anonymous"}`;
}

/** 读取托盘开关；默认关闭，非法值回落关闭。 */
export function loadUnscheduledTrayOpen(storage: Pick<Storage, "getItem"> | null, userId: string | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(unscheduledTrayStorageKey(userId)) === "true";
  } catch {
    return false;
  }
}

export function saveUnscheduledTrayOpen(
  storage: Pick<Storage, "setItem"> | null,
  userId: string | null,
  open: boolean
): void {
  if (!storage) return;
  try {
    storage.setItem(unscheduledTrayStorageKey(userId), open ? "true" : "false");
  } catch {
    // 隐私模式 / 配额满：静默失败，本次会话内开关仍生效。
  }
}
