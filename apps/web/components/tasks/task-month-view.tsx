"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Eye, Hourglass, Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { hasOpenDialog, useHotkey } from "@/lib/hooks/use-hotkey";
import { dateForDayView, isMonthGridCellEventTarget, type CalendarNavAction } from "@/lib/tasks/calendar-keyboard";
import { cn } from "@/lib/utils";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import { CountdownChip, CountdownProvider, useCountdownInteractions, type CountdownActions } from "./countdown-chip";
import { TaskDatePopover } from "@/components/tasks/task-date-popover";
import { annualOccurrenceDate } from "@/lib/tasks/countdown";
import {
  buildOverdueAgendaTasks,
  buildRangeAgenda,
  calendarDateOnly as dateOnly,
  calendarDayDiff as dayDiff,
  calendarDayKey as keyFor,
  calendarDayMarkers,
  calendarAddDate,
  getMonthCells,
  getTaskDate,
  getTaskEnd as taskEnd,
  isSameCalendarDay as isSameDay,
  monthSelectionOnEntry,
  shiftCalendarDay,
} from "@/lib/tasks/calendar-agenda";
import {
  calendarColumnCount,
  DEFAULT_CALENDAR_VIEW_OPTIONS,
  monthCellsForView,
  visibleWeekDays,
  weekStartOf,
  type CalendarViewOptions,
  type CalendarWeekStart,
} from "@/lib/tasks/calendar-view-options";
import {
  MAX_SPAN_LANES,
  allDayRowTasksOnDay,
  layoutSpanSegments,
  type SpanSegment,
} from "@/lib/tasks/calendar-allday-layout";
import { layoutDayTimedEventsWithOverflow, type WeekTimedEvent } from "@/lib/tasks/calendar-timed-layout";
import { isRecurringProjection, projectRecurringTasks, recurringSource } from "@/lib/tasks/recurring-occurrences";
import { isTaskOverdue } from "@/lib/tasks/workspace";
import { nudgeRange, resizeRangeFromPointer } from "@/lib/tasks/time-grid-resize";
import type { CalendarRescheduleShortcut } from "@/lib/tasks/calendar-reschedule";
import {
  CalendarTaskMenu,
  findCalendarTaskId,
  handleCalendarTaskKeyDown,
  useTaskLongPress,
  type CalendarTaskMenuActions,
  type CalendarTaskMenuRequest,
} from "./calendar-task-menu";
import {
  ALLDAY_TO_TIMED_DEFAULT_MIN,
  computeTimeGridDrop,
  type TimeGridZone,
} from "@/lib/tasks/allday-timed-convert";
import {
  resolveMonthDropTarget,
  resolveTimeGridDropTarget,
  type CalendarUnscheduledDragState,
  type UnscheduledDropTarget,
} from "@/lib/tasks/calendar-unscheduled";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";
import {
  CalendarTaskCheckbox,
  TaskRepeatIcon,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  recurringPresentation,
  timeLabel,
  weekdayLabel,
} from "./calendar-shared";
import { CalendarSwipeSurface } from "./calendar-swipe-surface";
import { CalendarFilterEmptyHint } from "./calendar-filter-bar";
import { DesktopAgendaView } from "./calendar-desktop-agenda";
import { MobileMonthView } from "./calendar-mobile-month";
import { calendarCreateAnchor, calendarCreatePreviewOnDay, type CalendarCreateAnchor, type CalendarCreatePreview } from "./calendar-quick-create";
import {
  DRAG_CREATE_MOVE_PX,
  dragCreateDayRange,
  dragCreateRangeLabel,
  dragCreateRowIndex,
  dragCreateWeekColumns,
  isDayInDragCreateRange,
  unionRect,
  type DragCreateDayRange,
} from "@/lib/tasks/calendar-drag-create";

// 纯日期函数已迁到 lib/tasks/calendar-agenda；这里保留导出给既有测试与调用方。
export { getMonthCells, getTaskDate };
export { layoutDayTimedEvents } from "@/lib/tasks/calendar-timed-layout";

const MONTH_NAMES = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
/** 每周最多可见泳道数，超出的折叠为 +N（与全天行共用，见 lib/tasks/calendar-allday-layout） */
export const MAX_LANES = MAX_SPAN_LANES;
const DAY_HEADER_PX = 28;
const LANE_HEIGHT_PX = 22;
/** 单元格底部为倒数日徽章预留的条带高度 */
const COUNTDOWN_STRIP_PX = 20;

export type CalendarMode = "day" | "week" | "month" | "year" | "agenda";

/** 日程视图每页天数：上一页/下一页按 30 天平移，「加载更多」每次再扩 30 天。 */
export const AGENDA_PAGE_DAYS = 30;

/** 空白创建回调；月格 / 全天行拖选传 `allDay=true`，避免快速新建把带 end 的区间当成定时。 */
export type CalendarDateClickHandler = (date: Date, end?: Date, anchor?: CalendarCreateAnchor, allDay?: boolean) => void;

const CALENDAR_MODE_TITLE: Record<CalendarMode, string> = {
  day: "日视图（d）",
  week: "周视图（w）",
  month: "月视图（m）",
  year: "年视图（y）",
  agenda: "日程视图（a）",
};

/** 指针横坐标相对当前周行映射为 0–cols-1，越过左右边缘时夹紧。 */
export function monthColFromClientX(clientX: number, rowLeft: number, rowWidth: number, cols = 7): number {
  if (rowWidth <= 0) return 0;
  return Math.min(cols - 1, Math.max(0, Math.floor(((clientX - rowLeft) / rowWidth) * cols)));
}

/** 月视图只换日期，保留原开始的本地墙钟时分（与既有改期合同一致）。 */
export function monthRescheduleTargetDate(target: Date, originalStart: Date): Date {
  return new Date(target.getFullYear(), target.getMonth(), target.getDate(), originalStart.getHours(), originalStart.getMinutes());
}

interface MonthDragState {
  task: TaskWithTags;
  originalStart: Date;
  pointerId: number;
  startX: number;
  startY: number;
  lane: number;
  moved: boolean;
  target: Date | null;
}

/** 月格空白拖选新建：capture 留在起点格子，跨行落点按周行矩形命中。 */
interface MonthCreateDragState {
  pointerId: number;
  cell: HTMLDivElement;
  startX: number;
  startY: number;
  anchorDate: Date;
  targetDate: Date;
  moved: boolean;
}

/* ------------------------- 日 / 周共用时间网格 ------------------------- */

const HOUR_HEIGHT = 56; // 1 小时网格高度
const SNAP_MIN = 30; // 拖拽吸附粒度
const GUTTER_W = 48; // 左侧小时轴宽度
/** 跨区（全天行 ↔ 时间网格）需要的最小纵向位移：半个吸附槽位，避免按在芯片底边/块顶边时抖动误转换。 */
const ZONE_SWITCH_PX = HOUR_HEIGHT / 4;
const WEEK_DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 给定任意日期，返回其所在周的周一 */
export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** 周视图的 7 天（默认周一到周日；weekStart=0 周日到周六） */
export function weekDaysOf(anchor: Date, weekStart: CalendarWeekStart = 1): Date[] {
  const first = weekStartOf(anchor, weekStart);
  return Array.from(
    { length: 7 },
    (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
  );
}

/** 拖拽落点按 30 分钟吸附 */
export function snapMinutes(minutes: number): number {
  return Math.max(0, Math.round(minutes / SNAP_MIN) * SNAP_MIN);
}

/** 本地墙钟时间，忽略秒数。 */
export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** 相对完整日期列顶部的像素位置 → 当天的 30 分钟槽位。 */
export function timeGridSlotMinutes(offsetY: number): number {
  return Math.min(1440 - SNAP_MIN, snapMinutes((offsetY / HOUR_HEIGHT) * 60));
}

/** 空白拖选独立按 15 分钟吸附；不改变已有任务的 30 分钟改期规则。 */
const CREATE_SNAP_MIN = 15;

export function timeGridRangeFromOffsets(startOffsetY: number, currentOffsetY: number): { startMin: number; endMin: number } {
  const snap = (offset: number) => Math.min(1440, Math.max(0,
    Math.round((offset / HOUR_HEIGHT) * 60 / CREATE_SNAP_MIN) * CREATE_SNAP_MIN
  ));
  const a = snap(startOffsetY);
  const b = snap(currentOffsetY);
  const startMin = Math.min(1440 - CREATE_SNAP_MIN, a, b);
  return { startMin, endMin: Math.max(startMin + CREATE_SNAP_MIN, a, b) };
}

interface TimeGridSelection {
  pointerId: number;
  column: HTMLDivElement;
  day: Date;
  dayIdx: number;
  startOffsetY: number;
  startMin: number;
  endMin: number;
  moved: boolean;
}

/** 全天行空白拖列新建跨天全天：capture 在起点列，落点列按整行宽度换算。 */
interface AllDaySelection {
  pointerId: number;
  column: HTMLDivElement;
  row: HTMLElement;
  startIdx: number;
  endIdx: number;
  startX: number;
  startY: number;
  moved: boolean;
}

/** 拖定时块上/下沿改开始或结束时间的会话状态（列固定，不跨列）。 */
interface TimeGridResizeState {
  pointerId: number;
  handle: HTMLSpanElement;
  column: HTMLDivElement;
  taskId: string;
  dayIdx: number;
  edge: "start" | "end";
  lane: number;
  lanes: number;
  origStartMin: number;
  origEndMin: number;
  startMin: number;
  endMin: number;
  moved: boolean;
}

/** 指针 clientY → 当天分钟数（未吸附）；列顶随网格滚动实时取值。 */
function timeGridPointerMinutes(column: HTMLDivElement, clientY: number): number {
  return ((clientY - column.getBoundingClientRect().top) / HOUR_HEIGHT) * 60;
}

interface WeekDragState {
  taskId: string;
  /** 起点：true 表示从全天行芯片拖起（决定哪个原卡片持有 capture 并半透明）。 */
  allDayChip: boolean;
  /** 当前落点区域；与起点不同即为全天 ↔ 定时转换。 */
  zone: TimeGridZone;
  grabOffsetMin: number;
  origDayIdx: number;
  origSlotMin: number;
  dayIdx: number;
  slotMin: number;
  moved: boolean;
}

interface WeekDragTarget {
  dayIdx: number;
  slotMin: number;
  zone: TimeGridZone;
}

function minutesLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

interface TimeGridViewProps {
  days: Date[];
  tasks: TaskWithTags[];
  countdowns: CountdownDay[];
  onTaskClick?: (task: TaskWithTags) => void;
  onToggleTaskDone?: (task: TaskWithTags) => void;
  onUpdateTaskSchedule?: (taskId: string, schedule: TaskSchedule) => Promise<void>;
  onDateClick?: CalendarDateClickHandler;
  createPreview?: CalendarCreatePreview | null;
  createdId?: string | null;
  /** 全天行 +N 弹层「在日视图打开」的落点；未提供时该按钮为空操作。 */
  onOpenDay?: (date: Date) => void;
  /** +N 弹层经 portal 渲染，根容器事件委托接不到，右键由这里显式上报。 */
  onTaskContextMenu?: (task: TaskWithTags, event: React.MouseEvent) => void;
  /** 未排期托盘拖入排期的会话（任务 + 指针位置）；moved 后计算落点并画预览。 */
  unscheduledDrag?: CalendarUnscheduledDragState | null;
  /** 落点上报（null = 网格外 / 未开始）；松手时页面取最后一次上报应用排期。 */
  onUnscheduledDragTarget?: (target: UnscheduledDropTarget | null) => void;
}

/** 时间网格列数 → grid-cols 类（隐藏周末时 5 列）。 */
const TIME_GRID_COLS: Record<number, string> = { 1: "grid-cols-1", 5: "grid-cols-5", 7: "grid-cols-7" };

/** 全天行连续条的几何：条高 / 泳道行距 / 倒数日 chip 行距（chip 12px + 4px 间隙）。 */
const ALLDAY_BAR_PX = 24;
const ALLDAY_LANE_PX = 28;
const ALLDAY_CHIP_ROW_PX = 16;

/** 列上第一条空闲泳道（0 起）；满员时叠放第一行（仅拖拽瞬态）。月格与全天行共用。 */
function firstFreeLaneForSegments(segments: SpanSegment[], col: number): number {
  for (let lane = 0; lane < MAX_LANES; lane += 1) {
    if (!segments.some((seg) => seg.lane === lane && seg.startCol <= col && col <= seg.endCol)) return lane;
  }
  return 0;
}

/** 跨天条的 aria 文案：`标题，10月20日–10月22日`；单日任务返回 undefined（按钮内容即名称）。 */
function allDaySpanLabel(task: TaskWithTags): string | undefined {
  const start = getTaskDate(task);
  if (!start) return undefined;
  const end = taskEnd(task);
  if (!end || isSameDay(start, end)) return undefined;
  const fmt = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${task.title}，${fmt(start)}–${fmt(end)}`;
}

/** 日 / 周视图共用 1、5 或 7 列时间网格，沿用同一套拖拽与创建回调。 */
export function TimeGridView({
  days,
  tasks: sourceTasks,
  countdowns,
  onTaskClick,
  onToggleTaskDone,
  onUpdateTaskSchedule,
  onDateClick,
  createPreview,
  createdId,
  onOpenDay,
  onTaskContextMenu,
  unscheduledDrag,
  onUnscheduledDragTarget,
}: TimeGridViewProps) {
  const { dragDate: countdownDragDate } = useCountdownInteractions();
  const rootRef = useRef<HTMLDivElement>(null);
  const allDayRowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);
  const grabRef = useRef({ offsetMin: 24, origDayIdx: 0, origSlotMin: 0, startClientY: 0 });
  const [drag, setDrag] = useState<WeekDragState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const todayIndex = days.findIndex((day) => isSameDay(day, now));
  const includesToday = todayIndex >= 0;
  const firstDayKey = keyFor(days[0]);
  const lastDayKey = keyFor(days[days.length - 1]);

  const tasks = useMemo(() => projectRecurringTasks(sourceTasks, days[0],
    shiftCalendarDay(days[days.length - 1], 1)), [sourceTasks, days]);

  const selectionRef = useRef<TimeGridSelection | null>(null);
  const [selection, setSelection] = useState<TimeGridSelection | null>(null);
  const suppressCreateClickRef = useRef(false);

  const resizeRef = useRef<TimeGridResizeState | null>(null);
  const [resize, setResize] = useState<TimeGridResizeState | null>(null);
  /** move 拖拽的 capture 元素，供 Esc 取消时释放（drag state 不含 DOM 引用）。 */
  const dragPointerRef = useRef<{ element: HTMLElement; pointerId: number } | null>(null);

  const clearSelection = useCallback(() => {
    const current = selectionRef.current;
    selectionRef.current = null;
    setSelection(null);
    if (current?.column.hasPointerCapture(current.pointerId)) {
      current.column.releasePointerCapture(current.pointerId);
    }
  }, []);

  const cancelSelection = useCallback(() => {
    if (!selectionRef.current) return;
    suppressCreateClickRef.current = true;
    clearSelection();
  }, [clearSelection]);

  const allDaySelectionRef = useRef<AllDaySelection | null>(null);
  const [allDaySelection, setAllDaySelection] = useState<AllDaySelection | null>(null);
  const suppressAllDayClickRef = useRef(false);

  const clearAllDaySelection = useCallback(() => {
    const current = allDaySelectionRef.current;
    allDaySelectionRef.current = null;
    setAllDaySelection(null);
    if (current?.column.hasPointerCapture(current.pointerId)) {
      current.column.releasePointerCapture(current.pointerId);
    }
  }, []);

  const cancelAllDaySelection = useCallback(() => {
    if (!allDaySelectionRef.current) return;
    suppressAllDayClickRef.current = true;
    clearAllDaySelection();
  }, [clearAllDaySelection]);

  useEffect(() => { cancelSelection(); cancelAllDaySelection(); }, [firstDayKey, lastDayKey, cancelSelection, cancelAllDaySelection]);

  const startSelection = (event: React.PointerEvent<HTMLDivElement>, day: Date, dayIdx: number) => {
    // 任务按钮及其子元素（包括手柄）不进入空白创建，即使未提供改期回调。
    if (!onDateClick || event.button !== 0 || !event.isPrimary || selectionRef.current ||
        (event.target as HTMLElement).closest("button, input, [role='button']")) return;
    suppressCreateClickRef.current = false;
    const column = event.currentTarget;
    const startOffsetY = event.clientY - column.getBoundingClientRect().top;
    const next = {
      pointerId: event.pointerId, column, day, dayIdx, startOffsetY,
      ...timeGridRangeFromOffsets(startOffsetY, startOffsetY), moved: false,
    };
    column.setPointerCapture(event.pointerId);
    selectionRef.current = next;
    setSelection(next);
  };

  const moveSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = selectionRef.current;
    if (!current || current.pointerId !== event.pointerId) return null;
    const offsetY = event.clientY - current.column.getBoundingClientRect().top;
    const next = {
      ...current, ...timeGridRangeFromOffsets(current.startOffsetY, offsetY),
      moved: current.moved || Math.abs(offsetY - current.startOffsetY) >= HOUR_HEIGHT * CREATE_SNAP_MIN / 60,
    };
    selectionRef.current = next;
    setSelection(next);
    return next;
  };

  const endSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = moveSelection(event);
    if (!current) return;
    clearSelection();
    if (!current.moved) return; // 轻点仍由 click 处理。
    suppressCreateClickRef.current = true;
    const { day, startMin, endMin } = current;
    const rect = current.column.getBoundingClientRect();
    onDateClick?.(
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, startMin),
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, endMin),
      calendarCreateAnchor(current.column, new DOMRect(rect.x, rect.y + startMin / 60 * HOUR_HEIGHT, rect.width, (endMin - startMin) / 60 * HOUR_HEIGHT))
    );
  };

  /* ---- 全天行空白：轻点建单日全天，拖过相邻列建跨天全天；列数已按隐藏周末裁剪。 ---- */
  const startAllDaySelection = (event: React.PointerEvent<HTMLDivElement>, dayIdx: number) => {
    // 倒数日 chip、+N 与连续条自己处理指针；这里再挡一次，连同非主键和进行中的手势。
    if (!onDateClick || event.button !== 0 || !event.isPrimary || allDaySelectionRef.current || selectionRef.current ||
        (event.target as HTMLElement).closest("button, input, [role='button'], [data-calendar-task-id]")) return;
    suppressAllDayClickRef.current = false;
    const column = event.currentTarget;
    const row = column.parentElement as HTMLElement;
    column.setPointerCapture(event.pointerId);
    const next: AllDaySelection = {
      pointerId: event.pointerId, column, row, startIdx: dayIdx, endIdx: dayIdx,
      startX: event.clientX, startY: event.clientY, moved: false,
    };
    allDaySelectionRef.current = next;
    setAllDaySelection(next);
  };

  const moveAllDaySelection = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = allDaySelectionRef.current;
    if (!current || current.pointerId !== event.pointerId) return null;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= DRAG_CREATE_MOVE_PX;
    const rect = current.row.getBoundingClientRect();
    const endIdx = moved && rect.width > 0 ? monthColFromClientX(event.clientX, rect.left, rect.width, days.length) : current.endIdx;
    if (current.moved === moved && current.endIdx === endIdx) return current;
    const next = { ...current, moved, endIdx };
    allDaySelectionRef.current = next;
    setAllDaySelection(next);
    return next;
  };

  const endAllDaySelection = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = moveAllDaySelection(event);
    if (!current) return;
    clearAllDaySelection();
    if (!current.moved) return; // 轻点仍由 click 处理。
    suppressAllDayClickRef.current = true;
    const lo = Math.min(current.startIdx, current.endIdx);
    const hi = Math.max(current.startIdx, current.endIdx);
    const first = (current.row.children[lo] as HTMLElement | undefined) ?? current.column;
    const last = (current.row.children[hi] as HTMLElement | undefined) ?? current.column;
    const union = unionRect(first.getBoundingClientRect(), last.getBoundingClientRect());
    onDateClick?.(
      dateOnly(days[lo]),
      lo === hi ? undefined : dateOnly(days[hi]),
      calendarCreateAnchor(first, new DOMRect(union.x, union.y, union.width, union.height)),
      true
    );
  };

  const cancelAllDaySelectionForEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    if (allDaySelectionRef.current?.pointerId === event.pointerId) cancelAllDaySelection();
  };

  const allDayCreateCols = allDaySelection?.moved
    ? { lo: Math.min(allDaySelection.startIdx, allDaySelection.endIdx), hi: Math.max(allDaySelection.startIdx, allDaySelection.endIdx) }
    : null;

  const dragTask = (drag && tasks.find((t) => t.id === drag.taskId)) || null;

  /* ---- 未排期托盘拖入：全天行 / 时间格槽位落点（容器外为 null）与上报 ---- */
  const unscheduledTarget = useMemo(() => {
    if (!unscheduledDrag?.moved) return null;
    return resolveTimeGridDropTarget({
      surfaceRect: rootRef.current?.getBoundingClientRect() ?? null,
      allDayRect: allDayRowRef.current?.getBoundingClientRect() ?? null,
      gridRect: gridRef.current?.getBoundingClientRect() ?? null,
      gridScrollTop: gridRef.current?.scrollTop ?? 0,
      gutterWidth: GUTTER_W,
      hourHeight: HOUR_HEIGHT,
      days,
      clientX: unscheduledDrag.clientX,
      clientY: unscheduledDrag.clientY,
    });
  }, [unscheduledDrag, days]);

  useEffect(() => {
    onUnscheduledDragTarget?.(unscheduledTarget);
  }, [unscheduledTarget, onUnscheduledDragTarget]);

  const unscheduledAllDayKey =
    unscheduledTarget?.zone === "all-day" ? keyFor(unscheduledTarget.date) : null;
  const unscheduledTimed = unscheduledTarget?.zone === "timed" ? unscheduledTarget : null;

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // 翻到新的日期范围时定位；分钟刷新不打断用户手动滚动。
    if (!gridRef.current) return;
    gridRef.current.scrollTop = includesToday
      ? Math.max(0, (minutesSinceMidnight(new Date()) / 60) * HOUR_HEIGHT - HOUR_HEIGHT)
      : 7 * HOUR_HEIGHT - 8;
  }, [firstDayKey, lastDayKey, includesToday]);

  const visibleCountdowns = useMemo(
    () => countdownsInRange(countdowns, days[0], days[days.length - 1]),
    [countdowns, days]
  );

  const dayEvents = useMemo(
    () => days.map((day) => layoutDayTimedEventsWithOverflow(tasks, day, { createdId })),
    [days, tasks, createdId]
  );

  // 全天行：全天任务 + 跨天任务画成跨列连续条（与月视图同一切段/泳道算法），
  // 倒数日仍按日独立 chip；单日定时任务留在时间网格。
  const { segments: allDaySegments, hiddenByCol } = useMemo(
    () => layoutSpanSegments(tasks, days, { allDayRowOnly: true, createdId }),
    [tasks, days, createdId]
  );

  const startTimedDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    task: TaskWithTags,
    dayIdx: number,
    ev: WeekTimedEvent
  ) => {
    if (!onUpdateTaskSchedule || isRecurringProjection(task)) return;
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetMin = Math.min(
      ev.endMin - ev.startMin,
      Math.max(0, ((event.clientY - rect.top) / HOUR_HEIGHT) * 60)
    );
    grabRef.current = { offsetMin, origDayIdx: dayIdx, origSlotMin: ev.startMin, startClientY: event.clientY };
    movedRef.current = false;
    dragPointerRef.current = { element: event.currentTarget, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      taskId: task.id,
      allDayChip: false,
      zone: "timed",
      grabOffsetMin: offsetMin,
      origDayIdx: dayIdx,
      origSlotMin: ev.startMin,
      dayIdx,
      slotMin: ev.startMin,
      moved: false,
    });
  };

  const startChipDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    task: TaskWithTags,
    startCol: number
  ) => {
    if (!onUpdateTaskSchedule || isRecurringProjection(task)) return;
    event.stopPropagation();
    // 连续条整条一个按钮：原列按按下位置计算（在条的哪一段抓住，该列就是「原地」），
    // 条内 wiggle 后落回原列不视为改期；无布局环境（jsdom）退回段起点列。
    const overlayRect = event.currentTarget.parentElement?.getBoundingClientRect();
    const grabDayIdx = overlayRect && overlayRect.width > 0
      ? monthColFromClientX(event.clientX, overlayRect.left, overlayRect.width, days.length)
      : startCol;
    grabRef.current = { offsetMin: 0, origDayIdx: grabDayIdx, origSlotMin: 0, startClientY: event.clientY };
    movedRef.current = false;
    dragPointerRef.current = { element: event.currentTarget, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      taskId: task.id,
      allDayChip: true,
      zone: "all-day",
      grabOffsetMin: 0,
      origDayIdx: grabDayIdx,
      origSlotMin: 0,
      dayIdx: grabDayIdx,
      slotMin: 0,
      moved: false,
    });
  };

  /**
   * 把指针位置换算成拖拽目标（区域 + 列 + 吸附槽位），供 moveDrag 与边缘自动滚动共用。
   * 网格顶边以上即全天行区域；离开起点区域需先走过 ZONE_SWITCH_PX，回到起点区域不设阈值。
   */
  const computeDragTarget = (clientX: number, clientY: number): WeekDragTarget | null => {
    if (!drag || !gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    const colWidth = (gridRef.current.clientWidth - GUTTER_W) / days.length;
    const dayIdx = Math.min(
      days.length - 1,
      Math.max(0, Math.floor((clientX - rect.left - GUTTER_W) / colWidth))
    );
    const origZone: TimeGridZone = drag.allDayChip ? "all-day" : "timed";
    const pointerZone: TimeGridZone = clientY < rect.top ? "all-day" : "timed";
    const zone =
      pointerZone === origZone || Math.abs(clientY - grabRef.current.startClientY) >= ZONE_SWITCH_PX
        ? pointerZone
        : origZone;
    const yMin =
      ((clientY - rect.top + gridRef.current.scrollTop) / HOUR_HEIGHT) * 60 -
      drag.grabOffsetMin;
    const slotMin = zone === "all-day"
      ? 0
      : Math.min(1440 - 30, snapMinutes(yMin));
    return { dayIdx, slotMin, zone };
  };

  /** 落点是否与起点不同：跨区、换列，或定时落点换了槽位。 */
  const isDragTargetChanged = (target: WeekDragTarget) => {
    if (!drag) return false;
    const origZone: TimeGridZone = drag.allDayChip ? "all-day" : "timed";
    return (
      target.zone !== origZone ||
      target.dayIdx !== grabRef.current.origDayIdx ||
      (target.zone === "timed" && target.slotMin !== grabRef.current.origSlotMin)
    );
  };

  // 指针悬在网格上下边缘时持续滚动，让长距离拖拽够得着视口外的时段
  const edgeScrollRef = useRef<number | null>(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const stopEdgeScroll = () => {
    if (edgeScrollRef.current !== null) {
      cancelAnimationFrame(edgeScrollRef.current);
      edgeScrollRef.current = null;
    }
  };
  const edgeScroll = (clientY: number) => {
    const grid = gridRef.current;
    if (!grid || !drag) {
      stopEdgeScroll();
      return;
    }
    const rect = grid.getBoundingClientRect();
    const EDGE = 48;
    let delta = 0;
    if (clientY < rect.top + EDGE) delta = -Math.ceil((rect.top + EDGE - clientY) / 6);
    else if (clientY > rect.bottom - EDGE) delta = Math.ceil((clientY - (rect.bottom - EDGE)) / 6);
    if (delta === 0) {
      stopEdgeScroll();
      return;
    }
    const maxScroll = grid.scrollHeight - grid.clientHeight;
    if (grid.scrollTop <= 0 && delta < 0) return;
    if (grid.scrollTop >= maxScroll && delta > 0) return;
    grid.scrollTop = Math.max(0, Math.min(maxScroll, grid.scrollTop + delta));
    const target = computeDragTarget(lastPointerRef.current.x, lastPointerRef.current.y);
    if (target) {
      const moved = isDragTargetChanged(target);
      if (moved) movedRef.current = true;
      setDrag((cur) =>
        cur && (cur.dayIdx !== target.dayIdx || cur.slotMin !== target.slotMin || cur.zone !== target.zone || cur.moved !== moved)
          ? { ...cur, ...target, moved }
          : cur
      );
    }
    edgeScrollRef.current = requestAnimationFrame(() => edgeScroll(clientY));
  };

  const moveDrag = (event: React.PointerEvent) => {
    if (!drag || !gridRef.current) return;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    const target = computeDragTarget(event.clientX, event.clientY);
    if (!target) return;
    const moved = isDragTargetChanged(target);
    if (moved) movedRef.current = true;
    if (target.dayIdx !== drag.dayIdx || target.slotMin !== drag.slotMin || target.zone !== drag.zone || moved !== drag.moved) {
      setDrag({ ...drag, ...target, moved });
    }
    if (target.zone === "timed") edgeScroll(event.clientY);
    else stopEdgeScroll();
  };

  useEffect(() => stopEdgeScroll, []);

  const endDrag = () => {
    stopEdgeScroll();
    dragPointerRef.current = null;
    if (!drag || !dragTask) {
      setDrag(null);
      return;
    }
    const current = drag;
    setDrag(null);
    if (!current.moved || !onUpdateTaskSchedule) return;
    const task = dragTask;
    const start = getTaskDate(task);
    if (!start) return;
    const end = taskEnd(task);
    if (!end) return;
    const next = computeTimeGridDrop({
      start,
      end,
      allDay: Boolean(task.all_day),
      from: current.allDayChip ? "all-day" : "timed",
      to: current.zone,
      day: days[current.dayIdx],
      slotMin: current.slotMin,
    });
    void onUpdateTaskSchedule(task.id, {
      ...next,
      timezone: task.timezone || null,
      recurrence_rule: task.recurrence_rule || null,
    });
  };

  /** 按住热区开始 resize：capture 落在热区 span 上，事件沿 DOM 冒泡仍可触发自身 handler。 */
  const startResize = (
    event: React.PointerEvent<HTMLSpanElement>,
    task: TaskWithTags,
    dayIdx: number,
    ev: WeekTimedEvent,
    edge: "start" | "end"
  ) => {
    if (isRecurringProjection(task) || !onUpdateTaskSchedule || event.button !== 0 || !event.isPrimary || resizeRef.current) return;
    event.stopPropagation();
    const column = event.currentTarget.closest("[data-time-grid-day]") as HTMLDivElement | null;
    if (!column) return;
    // 热区手势（无论是否改动/取消）之后的 click 都不打开详情。
    movedRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next: TimeGridResizeState = {
      pointerId: event.pointerId,
      handle: event.currentTarget,
      column,
      taskId: task.id,
      dayIdx,
      edge,
      lane: ev.lane,
      lanes: ev.lanes,
      origStartMin: ev.startMin,
      origEndMin: ev.endMin,
      startMin: ev.startMin,
      endMin: ev.endMin,
      moved: false,
    };
    resizeRef.current = next;
    setResize(next);
  };

  const updateResize = (clientY: number) => {
    const current = resizeRef.current;
    if (!current) return null;
    const range = resizeRangeFromPointer({
      edge: current.edge,
      startMin: current.origStartMin,
      endMin: current.origEndMin,
      pointerMin: timeGridPointerMinutes(current.column, clientY),
    });
    const moved =
      current.moved ||
      range.startMin !== current.origStartMin ||
      range.endMin !== current.origEndMin;
    const next = { ...current, ...range, moved };
    resizeRef.current = next;
    setResize(next);
    return next;
  };

  /** resize 的边缘自动滚动：与 edgeScroll 同一思路，滚动后按最新指针位置重算范围。 */
  const resizeEdgeScroll = (clientY: number) => {
    const grid = gridRef.current;
    if (!grid || !resizeRef.current) {
      stopEdgeScroll();
      return;
    }
    const rect = grid.getBoundingClientRect();
    const EDGE = 48;
    let delta = 0;
    if (clientY < rect.top + EDGE) delta = -Math.ceil((rect.top + EDGE - clientY) / 6);
    else if (clientY > rect.bottom - EDGE) delta = Math.ceil((clientY - (rect.bottom - EDGE)) / 6);
    if (delta === 0) {
      stopEdgeScroll();
      return;
    }
    const maxScroll = grid.scrollHeight - grid.clientHeight;
    if (grid.scrollTop <= 0 && delta < 0) return;
    if (grid.scrollTop >= maxScroll && delta > 0) return;
    grid.scrollTop = Math.max(0, Math.min(maxScroll, grid.scrollTop + delta));
    updateResize(lastPointerRef.current.y);
    edgeScrollRef.current = requestAnimationFrame(() => resizeEdgeScroll(clientY));
  };

  const moveResize = (event: React.PointerEvent) => {
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    updateResize(event.clientY);
    resizeEdgeScroll(event.clientY);
  };

  const clearResize = () => {
    const current = resizeRef.current;
    resizeRef.current = null;
    setResize(null);
    if (current && current.handle.hasPointerCapture(current.pointerId)) {
      current.handle.releasePointerCapture(current.pointerId);
    }
  };

  const endResize = (event: React.PointerEvent) => {
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    stopEdgeScroll();
    const finalResize = updateResize(event.clientY) ?? current;
    clearResize();
    const changed =
      finalResize.startMin !== finalResize.origStartMin ||
      finalResize.endMin !== finalResize.origEndMin;
    if (!changed || !onUpdateTaskSchedule) return;
    const task = tasks.find((t) => t.id === finalResize.taskId);
    if (!task) return;
    const day = days[finalResize.dayIdx];
    const newStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, finalResize.startMin);
    const newEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, finalResize.endMin);
    void onUpdateTaskSchedule(task.id, {
      schedule_start_at: newStart.toISOString(),
      schedule_end_at: newEnd.toISOString(),
      all_day: Boolean(task.all_day),
      timezone: task.timezone || null,
      recurrence_rule: task.recurrence_rule || null,
    });
  };

  const cancelResize = () => {
    if (!resizeRef.current) return;
    stopEdgeScroll();
    clearResize();
  };

  const cancelResizeForEvent = (event: React.PointerEvent) => {
    if (resizeRef.current?.pointerId === event.pointerId) cancelResize();
  };

  /** Esc 取消 move 拖拽：释放 capture、停滚动、清状态、拦住随后的 click。 */
  const cancelDrag = () => {
    stopEdgeScroll();
    const cap = dragPointerRef.current;
    if (cap && cap.element.hasPointerCapture(cap.pointerId)) {
      cap.element.releasePointerCapture(cap.pointerId);
    }
    dragPointerRef.current = null;
    movedRef.current = true;
    setDrag(null);
  };

  const cancelActiveGesture = () => {
    if (resizeRef.current) cancelResize();
    else if (drag) cancelDrag();
    else if (allDaySelectionRef.current) cancelAllDaySelection();
    else cancelSelection();
  };

  useHotkey(selection || allDaySelection || drag || resize
    ? [{ key: "Escape", handler: cancelActiveGesture, allowInInput: true }]
    : []);

  /** 聚焦定时块时的键盘微调：⌥↑/⌥↓ 平移 ±30 分钟，⌥⇧↑/⌥⇧↓ 缩短/延长 15 分钟。 */
  const handleTimedKeyDown = (
    event: React.KeyboardEvent,
    task: TaskWithTags,
    day: Date,
    ev: WeekTimedEvent
  ) => {
    if (isRecurringProjection(task) || !onUpdateTaskSchedule || !event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const resizeEnd = event.shiftKey;
    const deltaMin = event.key === "ArrowDown" ? (resizeEnd ? 15 : 30) : (resizeEnd ? -15 : -30);
    const next = nudgeRange({
      startMin: ev.startMin,
      endMin: ev.endMin,
      deltaMin,
      mode: resizeEnd ? "resize-end" : "move",
    });
    if (next.startMin === ev.startMin && next.endMin === ev.endMin) return;
    const newStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, next.startMin);
    const newEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, next.endMin);
    void onUpdateTaskSchedule(task.id, {
      schedule_start_at: newStart.toISOString(),
      schedule_end_at: newEnd.toISOString(),
      all_day: Boolean(task.all_day),
      timezone: task.timezone || null,
      recurrence_rule: task.recurrence_rule || null,
    });
  };

  /** 网格内 ghost 高度：从全天行拖进来按默认转换时长，定时块按原时长。 */
  const ghostDurationMin = (() => {
    if (!drag || !dragTask) return ALLDAY_TO_TIMED_DEFAULT_MIN;
    if (drag.allDayChip) return ALLDAY_TO_TIMED_DEFAULT_MIN;
    const start = getTaskDate(dragTask);
    const end = taskEnd(dragTask);
    if (!start || !end) return ALLDAY_TO_TIMED_DEFAULT_MIN;
    return Math.max(30, Math.round((end.getTime() - start.getTime()) / 60000));
  })();

  const hours = Array.from({ length: 24 }, (_, h) => h);

  // 全天行几何：倒数日 chip 占顶部条带（最高列决定行高），任务条按泳道排在下方。
  const maxCountdownRows = Array.from(visibleCountdowns.values()).reduce(
    (max, list) => Math.max(max, list.length),
    0
  );
  const stripTop = maxCountdownRows * ALLDAY_CHIP_ROW_PX;
  const laneTop = (lane: number) => stripTop + 4 + lane * ALLDAY_LANE_PX;
  const usedLanes = allDaySegments.reduce((max, seg) => Math.max(max, seg.lane + 1), 0);
  const hasOverflow = hiddenByCol.some((count) => count > 0);
  // 溢出列的 +N 固定占第 MAX_LANES 行（该列三条泳道必满），行高随之加一。
  const rowLanes = Math.max(usedLanes, hasOverflow ? MAX_LANES + 1 : 0);
  const hasCreatePreview = createPreview?.allDay && days.some((day) => calendarCreatePreviewOnDay(createPreview, day));
  const rowMinHeight = Math.max(38, stripTop + 8 + (rowLanes + (hasCreatePreview || allDayCreateCols ? 1 : 0)) * ALLDAY_LANE_PX - 4);
  const firstFreeLane = (di: number) => firstFreeLaneForSegments(allDaySegments, di);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 星期表头 */}
      <div className="flex shrink-0 border-b bg-background">
        <div className="w-12 shrink-0" />
        {days.map((day, i) => (
          <div
            key={i}
            className={cn(
              "min-w-0 flex-1 border-l px-1 py-2 text-center",
              isSameDay(day, now) && "bg-accent/60"
            )}
          >
            <div className="text-xs text-muted-foreground">{WEEK_DAY_LABELS[(day.getDay() + 6) % 7]}</div>
            <div
              className={cn(
                "mx-auto mt-0.5 grid h-6 w-6 place-items-center rounded-full text-sm",
                isSameDay(day, now) && "bg-primary font-semibold text-primary-foreground"
              )}
            >
              {day.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* 全天 / 跨天 / 倒数日 条：倒数日按日 chip 留在列内，任务画成跨列连续条 */}
      <div ref={allDayRowRef} data-countdown-surface="all-day" className="flex shrink-0 border-b bg-muted/20">
        <div className="grid w-12 shrink-0 place-items-center text-[10px] text-muted-foreground">
          全天
        </div>
        <div className={cn("relative min-w-0 flex-1 grid", TIME_GRID_COLS[days.length] ?? "grid-cols-7")}>
          {days.map((day, di) => {
            const chips_countdown = visibleCountdowns.get(keyFor(day)) || [];
            const allDayTarget = !!drag && drag.zone === "all-day" && drag.moved && drag.dayIdx === di;
            const externalAllDay = unscheduledAllDayKey === keyFor(day);
            const hiddenCount = hiddenByCol[di];
            const inAllDayCreate = !!allDayCreateCols && allDayCreateCols.lo <= di && di <= allDayCreateCols.hi;
            return (
              <div
                key={di}
                data-countdown-date={countdownDateKey(day)}
                data-calendar-drag-create={inAllDayCreate ? "all-day" : undefined}
                tabIndex={-1}
                className={cn(
                  "relative min-w-0 space-y-1 border-l p-1",
                  onDateClick && "select-none",
                  countdownDragDate === countdownDateKey(day) && "bg-primary/10 ring-2 ring-inset ring-primary",
                  isSameDay(day, now) && "bg-accent/60",
                  (allDayTarget || externalAllDay) && "bg-primary/5",
                  inAllDayCreate && "bg-primary/10"
                )}
                style={{ minHeight: rowMinHeight }}
                onPointerDown={onDateClick ? (event) => startAllDaySelection(event, di) : undefined}
                onPointerMove={onDateClick ? moveAllDaySelection : undefined}
                onPointerUp={onDateClick ? endAllDaySelection : undefined}
                onPointerCancel={onDateClick ? cancelAllDaySelectionForEvent : undefined}
                onLostPointerCapture={onDateClick ? cancelAllDaySelectionForEvent : undefined}
                onClick={onDateClick ? (event) => {
                  // 拖列松手后的兼容 click 已由拖选建卡，这里吞掉；轻点空白建当日单日全天。
                  if (suppressAllDayClickRef.current) {
                    suppressAllDayClickRef.current = false;
                    return;
                  }
                  if ((event.target as HTMLElement).closest("button, input, [role='button'], [data-calendar-task-id]")) return;
                  onDateClick(dateOnly(day), undefined, calendarCreateAnchor(event.currentTarget), true);
                } : undefined}
              >
                {chips_countdown.map((item) => (
                  <span key={item.id} data-calendar-created={item.id === createdId || undefined}><CountdownChip item={item} compact /></span>
                ))}
                {createPreview?.allDay && calendarCreatePreviewOnDay(createPreview, day) && (
                  <div
                    role="status"
                    data-calendar-create-preview="all-day"
                    className="absolute inset-x-1 z-20 flex items-center overflow-hidden rounded-md border border-dashed border-primary bg-background px-1 text-xs"
                    style={{ top: laneTop(rowLanes), height: ALLDAY_BAR_PX }}
                  >
                    <span className="truncate">{createPreview.title || "新事项"} · 全天</span>
                  </div>
                )}
                {/* 落点占位渲染在目标列（全天改日或定时块拖上来都走这里）；原条保持挂载以维持 pointer capture */}
                {allDayTarget && dragTask && (
                  <div
                    data-drop-placeholder="all-day"
                    className="absolute inset-x-1 z-20 flex items-center overflow-hidden rounded-[--radius-md] border-2 border-dashed border-primary/40 bg-primary/5 px-1.5 text-xs text-muted-foreground"
                    style={{ top: laneTop(firstFreeLane(di)), height: ALLDAY_BAR_PX }}
                  >
                    <span className="truncate">{dragTask.title}</span>
                  </div>
                )}
                {/* 未排期托盘拖入全天行的落点占位（同风格独立泳道） */}
                {externalAllDay && unscheduledDrag && (
                  <div
                    data-drop-placeholder="all-day"
                    data-drop-placeholder-source="tray"
                    className="absolute inset-x-1 z-20 flex items-center overflow-hidden rounded-[--radius-md] border-2 border-dashed border-primary/40 bg-primary/5 px-1.5 text-xs text-muted-foreground"
                    style={{ top: laneTop(firstFreeLane(di)), height: ALLDAY_BAR_PX }}
                  >
                    <span className="truncate">{unscheduledDrag.task.title}</span>
                  </div>
                )}
                {hiddenCount > 0 && (
                  <div className="absolute inset-x-1 z-10" style={{ top: laneTop(MAX_LANES), height: ALLDAY_BAR_PX }}>
                    <MonthDayPopover
                      date={day}
                      tasks={allDayRowTasksOnDay(tasks, day)}
                      countdowns={[]}
                      moreCount={hiddenCount}
                      tabIndex={0}
                      onOpenDay={() => onOpenDay?.(day)}
                      onTaskClick={onTaskClick}
                      onToggleTaskDone={onToggleTaskDone}
                      onTaskContextMenu={onTaskContextMenu}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {/* 连续条覆盖层：层本身不拦截指针，条可交互，列内倒数日与背景不受遮挡 */}
          <div className="pointer-events-none absolute inset-0">
            {allDaySegments.map((seg) => {
              const isDragged = drag?.taskId === seg.task.id && drag.allDayChip;
              const presentation = recurringPresentation(seg.task);
              const singleColumn = days.length === 1;
              return (
                <button
                  key={seg.task.id}
                  {...presentation}
                  data-calendar-created={seg.task.id === createdId || undefined}
                  data-calendar-task-id={seg.task.id}
                  data-all-day-span={`${seg.startCol}-${seg.endCol}`}
                  type="button"
                  aria-label={presentation["aria-label"] ?? allDaySpanLabel(seg.task)}
                  className={cn(
                    "pointer-events-auto absolute z-10 flex items-center gap-1 overflow-hidden px-1.5 text-left text-xs transition-colors hover:brightness-95",
                    categoryClass(seg.task),
                    !seg.continuesBefore && "rounded-l",
                    !seg.continuesAfter && "rounded-r",
                    onUpdateTaskSchedule && !isRecurringProjection(seg.task) && "cursor-grab select-none active:cursor-grabbing",
                    isDragged && "opacity-30"
                  )}
                  style={{
                    touchAction: isRecurringProjection(seg.task) ? "auto" : "none",
                    top: laneTop(seg.lane),
                    height: ALLDAY_BAR_PX,
                    left: `calc(${(seg.startCol / days.length) * 100}% + ${seg.continuesBefore ? 0 : 2}px)`,
                    width: `calc(${((seg.endCol - seg.startCol + 1) / days.length) * 100}% - ${(seg.continuesBefore ? 0 : 2) + (seg.continuesAfter ? 0 : 2)}px)`,
                  }}
                  onPointerDown={(e) => startChipDrag(e, seg.task, seg.startCol)}
                  onPointerMove={isDragged ? moveDrag : undefined}
                  onPointerUp={isDragged ? endDrag : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (movedRef.current) {
                      movedRef.current = false;
                      return;
                    }
                    onTaskClick?.(recurringSource(seg.task));
                  }}
                >
                  {seg.continuesBefore
                    ? (singleColumn && <span aria-hidden className="shrink-0 text-muted-foreground">‹</span>)
                    : <CalendarTaskCheckbox task={seg.task} onToggle={onToggleTaskDone} />}
                  <span className="min-w-0 flex-1 truncate"><TaskRepeatIcon task={seg.task} />{seg.task.title}</span>
                  {seg.continuesAfter && singleColumn && <span aria-hidden className="shrink-0 text-muted-foreground">›</span>}
                </button>
              );
            })}
            {/* 拖列新建的即时区间条：独立泳道，松手后由创建卡的 createPreview 接管 */}
            {allDayCreateCols && (
              <div
                role="status"
                data-calendar-drag-create-bar="all-day"
                className="absolute z-20 flex items-center overflow-hidden rounded-md border border-dashed border-primary bg-background px-1.5 text-xs font-medium"
                style={{
                  top: laneTop(rowLanes),
                  height: ALLDAY_BAR_PX,
                  left: `calc(${(allDayCreateCols.lo / days.length) * 100}% + 2px)`,
                  width: `calc(${((allDayCreateCols.hi - allDayCreateCols.lo + 1) / days.length) * 100}% - 4px)`,
                }}
              >
                <span className="truncate">{dragCreateRangeLabel(dragCreateDayRange(days[allDayCreateCols.lo], days[allDayCreateCols.hi]))}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 时间网格 */}
      <div ref={gridRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: 24 * HOUR_HEIGHT }}>
          {/* 小时轴 */}
          <div className="relative w-12 shrink-0">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {h}:00
              </div>
            ))}
          </div>
          <div className={cn("relative grid min-w-0 flex-1", TIME_GRID_COLS[days.length] ?? "grid-cols-7")}>
            {hours.map((h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-border/50"
                style={{ top: h * HOUR_HEIGHT }}
              />
            ))}
            {days.map((day, di) => {
              const target = drag && drag.moved && drag.dayIdx === di;
              const draft = createPreview && !createPreview.allDay && calendarCreatePreviewOnDay(createPreview, day) ? createPreview : null;
              const draftStart = draft ? minutesSinceMidnight(draft.start) : 0;
              const draftEnd = draft?.end ? (isSameDay(draft.end, day) ? minutesSinceMidnight(draft.end) : 1440) : draftStart + 60;
              return (
                <div
                  key={di}
                  className={cn(
                    "relative border-l select-none",
                    isSameDay(day, now) && "bg-accent/50",
                    target && "bg-primary/5"
                  )}
                  data-time-grid-day={keyFor(day)}
                  tabIndex={-1}
                  style={{ touchAction: onDateClick ? "none" : undefined }}
                  onPointerDown={(event) => startSelection(event, day, di)}
                  onPointerMove={moveSelection}
                  onPointerUp={endSelection}
                  onPointerCancel={(event) => {
                    if (selectionRef.current?.pointerId === event.pointerId) cancelSelection();
                  }}
                  onLostPointerCapture={(event) => {
                    if (selectionRef.current?.pointerId === event.pointerId) cancelSelection();
                  }}
                  onClick={
                    onDateClick
                      ? (e) => {
                          if (suppressCreateClickRef.current) {
                            suppressCreateClickRef.current = false;
                            return;
                          }
                          const rect = e.currentTarget.getBoundingClientRect();
                          const slot = timeGridSlotMinutes(e.clientY - rect.top);
                          onDateClick(
                            new Date(
                              day.getFullYear(),
                              day.getMonth(),
                              day.getDate(),
                              Math.floor(slot / 60),
                              slot % 60
                            ),
                            new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, slot + 60),
                            calendarCreateAnchor(e.currentTarget, new DOMRect(rect.x, rect.y + slot / 60 * HOUR_HEIGHT, rect.width, HOUR_HEIGHT))
                          );
                        }
                      : undefined
                  }
                >
                  {di === todayIndex && (
                    <div
                      role="img"
                      aria-label={`此刻 ${minutesLabel(minutesSinceMidnight(now))}`}
                      className="pointer-events-none absolute inset-x-0 z-20 border-t border-destructive"
                      style={{ top: (minutesSinceMidnight(now) / 60) * HOUR_HEIGHT }}
                    >
                      <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
                    </div>
                  )}
                  {dayEvents[di].visible.map((ev) => {
                    const isDragged =
                      drag?.taskId === ev.task.id && !drag.allDayChip;
                    const isResizing = resize?.taskId === ev.task.id;
                    const blockHeightPx = Math.max(
                      ((ev.endMin - ev.startMin) / 60) * HOUR_HEIGHT - 2,
                      12
                    );
                    return (
                      <button
                        key={ev.task.id}
                        {...recurringPresentation(ev.task)}
                        data-calendar-created={ev.task.id === createdId || undefined}
                        data-calendar-task-id={ev.task.id}
                        type="button"
                        className={cn(
                          "absolute inset-x-0.5 z-10 flex overflow-hidden px-1.5 text-left text-xs font-medium",
                          ev.endMin - ev.startMin < 30 ? "items-center gap-1 leading-none" : "flex-col items-start gap-0.5 py-1",
                          categoryClass(ev.task),
                          (isDragged || isResizing) && "opacity-30"
                        )}
                        style={{
                          top: (ev.startMin / 60) * HOUR_HEIGHT + 1,
                          height: blockHeightPx,
                          width: ev.lanes > 1 ? `calc(${100 / ev.lanes}% - 4px)` : undefined,
                          left: ev.lanes > 1 ? `calc(${(ev.lane * 100) / ev.lanes}% + 2px)` : undefined,
                          touchAction: isRecurringProjection(ev.task) ? "auto" : "none",
                        }}
                        aria-keyshortcuts={
                          onUpdateTaskSchedule && !isRecurringProjection(ev.task)
                            ? "Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
                            : undefined
                        }
                        onPointerDown={(e) => startTimedDrag(e, ev.task, di, ev)}
                        onPointerMove={isDragged ? moveDrag : undefined}
                        onPointerUp={isDragged ? endDrag : undefined}
                        onKeyDown={(e) => handleTimedKeyDown(e, ev.task, day, ev)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (movedRef.current) {
                            movedRef.current = false;
                            return;
                          }
                          onTaskClick?.(recurringSource(ev.task));
                        }}
                      >
                        <CalendarTaskCheckbox task={ev.task} onToggle={onToggleTaskDone} className="h-3 w-3" />
                        <span className={cn("truncate opacity-80", ev.endMin - ev.startMin < 30 ? "shrink-0" : "w-full")}>
                          {minutesLabel(ev.startMin)}
                        </span>
                        <span className={ev.endMin - ev.startMin < 30 ? "truncate" : "line-clamp-3 w-full"}><TaskRepeatIcon task={ev.task} />{ev.task.title}</span>
                        {/* 上/下沿 resize 热区（span 非交互元素，可嵌在 button 内；
                            必须排在内容 span 之后，保持 querySelector("span") 仍取到时间标签） */}
                        {onUpdateTaskSchedule && !isRecurringProjection(ev.task) && blockHeightPx >= 20 && (["start", "end"] as const).map((edge) => (
                          <span
                            key={edge}
                            aria-hidden
                            data-resize-edge={edge}
                            className={cn(
                              "absolute inset-x-0 h-1.5 cursor-ns-resize",
                              edge === "start" ? "top-0" : "bottom-0"
                            )}
                            style={{ touchAction: "none" }}
                            onPointerDown={(e) => startResize(e, ev.task, di, ev, edge)}
                            onPointerMove={moveResize}
                            onPointerUp={endResize}
                            onPointerCancel={cancelResizeForEvent}
                            onLostPointerCapture={cancelResizeForEvent}
                          />
                        ))}
                      </button>
                    );
                  })}
                  {dayEvents[di].overflowClusters.map((cluster) => (
                    <div
                      key={`${cluster.dayKey}-${cluster.startMin}`}
                      className="absolute right-0.5 z-20"
                      style={{ top: (cluster.startMin / 60) * HOUR_HEIGHT + 8 }}
                    >
                      <MonthDayPopover
                        date={day}
                        tasks={cluster.tasks}
                        countdowns={[]}
                        moreCount={cluster.hiddenCount}
                        timedRange={cluster}
                        tabIndex={0}
                        onOpenDay={() => onOpenDay?.(day)}
                        onTaskClick={onTaskClick}
                        onToggleTaskDone={onToggleTaskDone}
                        onTaskContextMenu={onTaskContextMenu}
                      />
                    </div>
                  ))}
                  {draft && (
                    <div role="status" data-calendar-create-preview="timed" className="pointer-events-none absolute inset-x-0.5 z-30 rounded-md border border-dashed border-primary bg-background px-1 text-xs tabular-nums"
                      style={{ top: draftStart / 60 * HOUR_HEIGHT, height: Math.max(14, (draftEnd - draftStart) / 60 * HOUR_HEIGHT) }}>
                      <span className="block whitespace-nowrap rounded-sm bg-background">{minutesLabel(draftStart)} – {minutesLabel(draftEnd)}</span>
                      <span className="block truncate bg-background font-medium">{draft.title || "新任务"}</span>
                    </div>
                  )}
                  {selection?.moved && selection.dayIdx === di && (
                    <div
                      role="status"
                      className="pointer-events-none absolute inset-x-0.5 z-30 rounded-md border border-dashed border-primary/40 bg-primary/10 px-1 text-xs font-medium tabular-nums"
                      style={{
                        top: (selection.startMin / 60) * HOUR_HEIGHT,
                        height: ((selection.endMin - selection.startMin) / 60) * HOUR_HEIGHT,
                      }}
                    >
                      <span className="whitespace-nowrap rounded-sm bg-background px-0.5">
                        {minutesLabel(selection.startMin)} – {minutesLabel(selection.endMin)}
                      </span>
                    </div>
                  )}
                  {/* resize 预览：虚线框 + 实时「HH:MM – HH:MM」，与原块同 lane 定位 */}
                  {resize && resize.dayIdx === di && (
                    <div
                      role="status"
                      className="pointer-events-none absolute inset-x-0.5 z-30 rounded-md border border-dashed border-primary/40 bg-primary/10 px-1 text-xs font-medium tabular-nums"
                      style={{
                        top: (resize.startMin / 60) * HOUR_HEIGHT,
                        height: ((resize.endMin - resize.startMin) / 60) * HOUR_HEIGHT,
                        width: resize.lanes > 1 ? `calc(${100 / resize.lanes}% - 4px)` : undefined,
                        left: resize.lanes > 1 ? `calc(${(resize.lane * 100) / resize.lanes}% + 2px)` : undefined,
                      }}
                    >
                      <span className="whitespace-nowrap rounded-sm bg-background px-0.5">
                        {minutesLabel(resize.startMin)} – {minutesLabel(resize.endMin)}
                      </span>
                    </div>
                  )}
                  {/* 拖拽中的虚线占位框（仅目标列；从全天行拖进来时同样按转换时长画） */}
                  {drag && drag.zone === "timed" && drag.moved && drag.dayIdx === di && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-20 rounded-[--radius-md] border-2 border-dashed border-primary/40 bg-primary/5"
                      style={{
                        top: (drag.slotMin / 60) * HOUR_HEIGHT + 1,
                        height: Math.max((ghostDurationMin / 60) * HOUR_HEIGHT - 2, 26),
                      }}
                    />
                  )}
                  {/* 拖拽幽灵卡：跟手吸附到 30 分钟槽位，带目标日时间标签 */}
                  {drag &&
                  drag.zone === "timed" &&
                  drag.moved &&
                  drag.dayIdx === di &&
                  dragTask && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-30"
                      style={{
                        top: (drag.slotMin / 60) * HOUR_HEIGHT + 1,
                        height: Math.max(
                          ((ghostDurationMin) / 60) * HOUR_HEIGHT - 2,
                          26
                        ),
                      }}
                    >
                      <div
                        className={cn(
                          "flex h-full w-full -rotate-2 items-center justify-center overflow-hidden rounded-[--radius-md] px-1.5 opacity-80 shadow-lg",
                          categoryClass(dragTask)
                        )}
                      >
                        <span className="truncate text-sm font-semibold">
                          {WEEK_DAY_LABELS[(days[drag.dayIdx].getDay() + 6) % 7]} {minutesLabel(drag.slotMin)} – {minutesLabel(Math.min(1440, drag.slotMin + ghostDurationMin))}
                        </span>
                      </div>
                    </div>
                  )}
                  {/* 未排期托盘拖入定时槽位：占位框 + 幽灵卡（默认时长与全天⇄定时互转一致） */}
                  {unscheduledDrag && unscheduledTimed && keyFor(unscheduledTimed.date) === keyFor(day) && (
                    <>
                      <div
                        aria-hidden="true"
                        data-drop-placeholder-source="tray"
                        className="pointer-events-none absolute inset-x-0.5 z-20 rounded-[--radius-md] border-2 border-dashed border-primary/40 bg-primary/5"
                        style={{
                          top: (unscheduledTimed.slotMin / 60) * HOUR_HEIGHT + 1,
                          height: Math.max((ALLDAY_TO_TIMED_DEFAULT_MIN / 60) * HOUR_HEIGHT - 2, 26),
                        }}
                      />
                      <div
                        role="status"
                        className="pointer-events-none absolute inset-x-0.5 z-30"
                        style={{
                          top: (unscheduledTimed.slotMin / 60) * HOUR_HEIGHT + 1,
                          height: Math.max((ALLDAY_TO_TIMED_DEFAULT_MIN / 60) * HOUR_HEIGHT - 2, 26),
                        }}
                      >
                        <div
                          className={cn(
                            "flex h-full w-full -rotate-2 items-center justify-center overflow-hidden rounded-[--radius-md] px-1.5 opacity-80 shadow-lg",
                            categoryClass(unscheduledDrag.task)
                          )}
                        >
                          <span className="truncate text-sm font-semibold">
                            {WEEK_DAY_LABELS[(day.getDay() + 6) % 7]} {minutesLabel(unscheduledTimed.slotMin)} – {minutesLabel(Math.min(1440, unscheduledTimed.slotMin + ALLDAY_TO_TIMED_DEFAULT_MIN))}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 把倒数日按可视范围铺开成 日期key → 倒数日列表；每年重复的按年展开 */
export function countdownsInRange(
  countdowns: CountdownDay[],
  start: Date,
  end: Date
): Map<string, CountdownDay[]> {
  const map = new Map<string, CountdownDay[]>();
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (const item of countdowns) {
    for (let year = from.getFullYear(); year <= to.getFullYear(); year += 1) {
      const occurrence = item.repeat_annually ? annualOccurrenceDate(item.target_date, year) : item.target_date;
      const [y, m, d] = occurrence.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      if (date < from || date > to) continue;
      const key = keyFor(date);
      map.set(key, [...(map.get(key) || []), item]);
    }
  }
  return map;
}

export function groupTasksByDate(tasks: TaskWithTags[]) {
  const grouped = new Map<string, TaskWithTags[]>();
  tasks.forEach((task) => {
    const date = getTaskDate(task);
    if (!date) return;
    const key = date.toDateString();
    grouped.set(key, [...(grouped.get(key) || []), task]);
  });
  return grouped;
}

function countdownDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export type WeekSegment = SpanSegment;

/**
 * 月视图格的跨天任务连续条布局（含单日任务）。
 * 切段 / 泳道 / +N 折叠的共享实现已迁 lib/tasks/calendar-allday-layout，
 * 与日/周时间网格全天行共用，避免两套算法漂移。
 */
export function layoutWeekSegments(
  tasks: TaskWithTags[],
  week: Date[],
  createdId?: string | null
): { segments: WeekSegment[]; hiddenByCol: number[] } {
  return layoutSpanSegments(tasks, week, { createdId });
}

/**
 * 某一天盖住的全部任务（含跨天，首尾日都算）。
 * 与 layoutWeekSegments 一样按本地日期比较，不用时刻切断。
 * 因此某一列的「可见段 + hiddenByCol」等于这里的条数。
 */
export function tasksOnDay(tasks: TaskWithTags[], day: Date): TaskWithTags[] {
  const target = dateOnly(day).getTime();
  return tasks
    .filter((task) => {
      const start = getTaskDate(task);
      if (!start) return false;
      const end = taskEnd(task) || start;
      return dateOnly(start).getTime() <= target && dateOnly(end).getTime() >= target;
    })
    .sort((a, b) => {
      const time = (getTaskDate(a)?.getTime() || 0) - (getTaskDate(b)?.getTime() || 0);
      return time || a.sort_order - b.sort_order || a.id.localeCompare(b.id);
    });
}

/** 月网格 roving tabindex：已选日若在本月就用它，否则今天，再否则本月 1 日。 */
export function monthGridRovingDate(cursor: Date, today: Date, preferred: Date | null): Date {
  if (preferred && preferred.getFullYear() === cursor.getFullYear() && preferred.getMonth() === cursor.getMonth()) {
    return new Date(preferred.getFullYear(), preferred.getMonth(), preferred.getDate());
  }
  if (today.getFullYear() === cursor.getFullYear() && today.getMonth() === cursor.getMonth()) {
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }
  return new Date(cursor.getFullYear(), cursor.getMonth(), 1);
}

/** 格内「+N」：折叠任务数，加上除第一条以外的倒数日。没有折叠任务时，只有多余倒数日也算。 */
export function monthCellOverflowCount(hiddenTasks: number, countdownCount: number): number {
  return hiddenTasks + Math.max(0, countdownCount - 1);
}

function categoryClass(task: TaskWithTags) {
  if (isRecurringProjection(task)) return "border border-dashed border-border bg-background text-muted-foreground";
  if (task.status === "done") return "bg-muted text-muted-foreground line-through";
  return "border border-border bg-accent text-foreground";
}

interface TaskMonthViewProps extends CountdownActions {
  tasks: TaskWithTags[];
  countdowns?: CountdownDay[];
  onTaskClick?: (task: TaskWithTags) => void;
  /** 日历内勾选完成（乐观更新 + 撤销 toast 由调用方负责）。 */
  onToggleTaskDone?: (task: TaskWithTags) => void;
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
  onUpdateTaskSchedule?: (taskId: string, schedule: TaskSchedule) => Promise<void>;
  /** 右键/长按/键盘菜单的改期快捷项（今天/明天/下周第一天/清除日期；撤销 toast 由调用方负责）。 */
  onRescheduleTaskShortcut?: (task: TaskWithTags, shortcut: CalendarRescheduleShortcut) => void;
  /** 右键菜单「复制一份」：同一时间创建副本（标题加「副本」后缀）。 */
  onDuplicateTask?: (task: TaskWithTags) => void;
  /** 右键菜单「删除」：软删 + 撤销 toast（useTaskMutations.deleteTask 同一链路）。 */
  onDeleteTask?: (taskId: string) => void;
  /** 点击月视图格子空白处、日视图与手机周议程的添加按钮时打开添加。日期数字和年视图改走日视图。 */
  onDateClick?: CalendarDateClickHandler;
  createPreview?: CalendarCreatePreview | null;
  createdId?: string | null;
  /** 显示选项（周起始日 / 周末列）；缺省等于默认值，不改变既有行为。 */
  viewOptions?: CalendarViewOptions;
  /** 显示选项变更（工具栏「显示」菜单）。 */
  onViewOptionsChange?: (next: CalendarViewOptions) => void;
  /** 工具栏插槽（如未排期任务开关按钮）；渲染在导航与「显示」菜单之间。 */
  toolbarAction?: React.ReactNode;
  /** 日历筛选生效时的条件 chip 行（页面组装）；渲染在工具栏正下方。 */
  calendarFilterBar?: React.ReactNode;
  /** 筛选生效标记：可见范围内无任务时显示「当前筛选下没有任务」轻提示。 */
  calendarFilterActive?: boolean;
  /** 轻提示的「清除筛选」动作。 */
  onClearCalendarFilter?: () => void;
  /** 未排期托盘拖入排期的会话；视图内计算落点并渲染预览。 */
  unscheduledDrag?: CalendarUnscheduledDragState | null;
  /** 落点上报（null = 日历外 / 未开始）；页面在松手时取最后一次上报应用排期。 */
  onUnscheduledDragTarget?: (target: UnscheduledDropTarget | null) => void;
}

const MONTH_CELL_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px] focus-visible:ring-offset-background";

function MonthDayPopover({
  date,
  tasks,
  countdowns,
  moreCount,
  timedRange,
  tabIndex,
  onOpenDay,
  onTaskClick,
  onToggleTaskDone,
  onTaskContextMenu,
  onAdd,
}: {
  date: Date;
  tasks: TaskWithTags[];
  countdowns: CountdownDay[];
  moreCount: number;
  timedRange?: { startMin: number; endMin: number };
  tabIndex: number;
  onOpenDay: () => void;
  onTaskClick?: (task: TaskWithTags) => void;
  onToggleTaskDone?: (task: TaskWithTags) => void;
  /** 弹层内容经 portal 渲染，根容器的事件委托接不到，右键由这里显式上报。 */
  onTaskContextMenu?: (task: TaskWithTags, event: React.MouseEvent) => void;
  onAdd?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const label = `${date.getMonth() + 1}月${date.getDate()}日`;
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7];
  const total = tasks.length + countdowns.length;
  const rangeLabel = timedRange ? `${minutesLabel(timedRange.startMin)} – ${minutesLabel(timedRange.endMin)}` : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          tabIndex={tabIndex}
          data-timed-overlap-more={timedRange ? "" : undefined}
          aria-label={`查看 ${label}${rangeLabel ? ` ${rangeLabel} 重叠任务` : ""} 全部 ${total} 项`}
          className={cn("ml-auto h-5 min-h-0 shrink-0 px-1 text-xs font-normal text-muted-foreground md:h-5 md:min-h-0", timedRange && "border bg-background text-foreground hover:bg-accent")}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
        >
          +{moreCount}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        aria-labelledby={titleId}
        className="w-72 p-0"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          // 非模态弹层在点外面关闭时不会自己把焦点交回触发器。Esc 和点外面都回到「+N」。
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <h3 id={titleId} className="min-w-0 flex-1 text-sm font-semibold">
            {label} {weekday}
            {rangeLabel && <span className="block text-xs font-normal tabular-nums text-muted-foreground">{rangeLabel}</span>}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs md:min-h-0"
            onClick={() => {
              setOpen(false);
              onOpenDay();
            }}
          >
            在日视图打开
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {tasks.map((task) => (
            <button
              key={task.id}
              {...recurringPresentation(task)}
              data-calendar-task-id={task.id}
              type="button"
              onContextMenu={(event) => onTaskContextMenu?.(task, event)}
              onClick={() => {
                setOpen(false);
                onTaskClick?.(recurringSource(task));
              }}
              className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs", categoryClass(task))}
            >
              <CalendarTaskCheckbox task={task} onToggle={onToggleTaskDone} />
              <span className="min-w-0 flex-1 truncate"><TaskRepeatIcon task={task} />{task.title}</span>
              {timeLabel(task) ? <span className={cn("shrink-0 text-[10px]", timedRange ? "tabular-nums text-muted-foreground" : "opacity-70")}>{timeLabel(task)}</span> : null}
            </button>
          ))}
          {countdowns.map((item) => (
            <div key={item.id} className="flex min-w-0 items-center px-3 py-1.5 hover:bg-accent">
              <CountdownChip item={item} />
            </div>
          ))}
        </div>
        {onAdd && (
          <div className="border-t p-2">
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => { setOpen(false); onAdd(); }}>
              <Plus className="h-4 w-4" />
              添加
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** 工具栏「显示」菜单：已完成任务 / 倒数日 / 周末列 / 周起始日。
 *  方向键在菜单项间移动焦点，Esc 由 Popover 关闭并还焦点给触发器。 */
function CalendarViewOptionsMenu({
  options,
  onChange,
}: {
  options: CalendarViewOptions;
  onChange: (next: CalendarViewOptions) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const toggle = (patch: Partial<CalendarViewOptions>) => onChange({ ...options, ...patch });

  const focusMenuItem = (from: HTMLElement, direction: 1 | -1) => {
    const root = contentRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])"));
    if (items.length === 0) return;
    const index = items.indexOf(from);
    const next = items[(index + direction + items.length * 2) % items.length];
    next?.focus();
  };

  const menuItemClass = cn(
    "flex w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm font-normal",
    "min-h-11 md:min-h-0 md:py-2"
  );
  const checkedMark = (checked: boolean) => (
    <span
      aria-hidden
      className={cn(
        "grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-semibold leading-none",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40 text-transparent"
      )}
    >
      ✓
    </span>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 非模态弹层 Esc/点外关闭时把焦点还给触发器（与月格 +N 弹层同模式）。
        if (!next) triggerRef.current?.focus();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="sm"
          aria-label="日历显示选项"
          title="日历显示选项"
          className="shrink-0"
        >
          <Eye className="h-4 w-4" />
          显示
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        collisionPadding={8}
        role="menu"
        aria-label="日历显示选项"
        className="w-64 p-1.5"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const current = document.activeElement instanceof HTMLElement && contentRef.current?.contains(document.activeElement)
              ? document.activeElement
              : (event.currentTarget as HTMLElement);
            focusMenuItem(current, event.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <Button type="button" variant="ghost" role="menuitemcheckbox" aria-checked={options.showCompleted} className={menuItemClass} onClick={() => toggle({ showCompleted: !options.showCompleted })}>
          <span>显示已完成任务</span>
          {checkedMark(options.showCompleted)}
        </Button>
        <Button type="button" variant="ghost" role="menuitemcheckbox" aria-checked={options.showCountdowns} className={menuItemClass} onClick={() => toggle({ showCountdowns: !options.showCountdowns })}>
          <span>显示倒数日</span>
          {checkedMark(options.showCountdowns)}
        </Button>
        <Button type="button" variant="ghost" role="menuitemcheckbox" aria-checked={options.showWeekends} className={menuItemClass} onClick={() => toggle({ showWeekends: !options.showWeekends })}>
          <span>显示周末</span>
          {checkedMark(options.showWeekends)}
        </Button>
        <div className="my-1.5 border-t" role="separator" />
        <div className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span className="text-sm text-muted-foreground">周起始日</span>
          <div role="group" aria-label="周起始日" className="flex gap-1 rounded-lg bg-muted p-1">
            {([1, 0] as CalendarWeekStart[]).map((start) => (
              <button
                key={start}
                type="button"
                role="menuitemradio"
                aria-checked={options.weekStart === start}
                onClick={() => toggle({ weekStart: start })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  options.weekStart === start ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {start === 1 ? "周一" : "周日"}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TaskMonthView(props: TaskMonthViewProps) {
  return <CountdownProvider onUpdateCountdown={props.onUpdateCountdown} onDeleteCountdown={props.onDeleteCountdown}><TaskMonthViewContent {...props} /></CountdownProvider>;
}

function TaskMonthViewContent({
  tasks,
  countdowns = [],
  onTaskClick,
  onToggleTaskDone,
  onRescheduleTask,
  onUpdateTaskSchedule,
  onRescheduleTaskShortcut,
  onDuplicateTask,
  onDeleteTask,
  onDateClick,
  createPreview,
  createdId,
  viewOptions,
  onViewOptionsChange,
  toolbarAction,
  calendarFilterBar,
  calendarFilterActive,
  onClearCalendarFilter,
  unscheduledDrag,
  onUnscheduledDragTarget,
}: TaskMonthViewProps) {
  const { dragDate: countdownDragDate } = useCountdownInteractions();
  const today = new Date();
  const weekStart = viewOptions?.weekStart ?? 1;
  const showWeekends = viewOptions?.showWeekends ?? true;
  const colCount = calendarColumnCount(showWeekends);
  const [mode, setMode] = useState<CalendarMode>("month");
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  // 键盘连发发生在下一次渲染之前，翻页必须读到刚写入的日期。
  const modeRef = useRef(mode);
  const cursorRef = useRef(cursor);
  const selectedRef = useRef(selectedDate);
  modeRef.current = mode;
  cursorRef.current = cursor;
  selectedRef.current = selectedDate;
  const monthGridRef = useRef<HTMLDivElement>(null);
  const monthRowsRef = useRef<Array<HTMLDivElement | null>>([]);
  const monthCellRefs = useRef(new Map<string, HTMLDivElement>());
  const [keyboardCreate, setKeyboardCreate] = useState<{ date: Date; timed: boolean; focusTarget?: HTMLElement } | null>(null);
  const [rovingDate, setRovingDate] = useState<Date | null>(null);
  const rovingRef = useRef<Date | null>(null);
  // 方向键连发时，焦点还在旧格子上，下一次位移要从已经写下的目标日接着算。
  const pendingMonthFocusKey = useRef<string | null>(null);
  const activeRovingDate = monthGridRovingDate(cursor, today, rovingDate);
  // ref 同步保存最终落点，避免 pointermove/up 紧邻时读到上一帧的 React state。
  const monthDragRef = useRef<MonthDragState | null>(null);
  const suppressMonthClickRef = useRef(false);
  const [monthDrag, setMonthDrag] = useState<MonthDragState | null>(null);
  const dragOverDate = monthDrag?.moved && monthDrag.target ? keyFor(monthDrag.target) : null;
  const monthCreateRef = useRef<MonthCreateDragState | null>(null);
  const suppressMonthCreateClickRef = useRef(false);
  const [monthCreate, setMonthCreate] = useState<MonthCreateDragState | null>(null);
  const monthCreateRange: DragCreateDayRange | null = monthCreate?.moved ? dragCreateDayRange(monthCreate.anchorDate, monthCreate.targetDate) : null;
  // 日程视图「加载更多」页数：翻页 / 回今天 / 切模式时归零（见 step/goToday/switchMode）。
  const [agendaExtraPages, setAgendaExtraPages] = useState(0);
  const agendaRangeDays = AGENDA_PAGE_DAYS * (1 + agendaExtraPages);
  const cells = useMemo(() => monthCellsForView(cursor, weekStart, showWeekends), [cursor, weekStart, showWeekends]);
  const weekDays = useMemo(() => visibleWeekDays(weekDaysOf(cursor, weekStart), showWeekends), [cursor, weekStart, showWeekends]);
  const revealedCreateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!createdId || revealedCreateRef.current === createdId) return;
    const task = tasks.find((item) => item.id === createdId);
    const countdown = countdowns.find((item) => item.id === createdId);
    const date = task ? getTaskDate(task) : countdown ? new Date(`${countdown.repeat_annually ? annualOccurrenceDate(countdown.target_date, cursorRef.current.getFullYear()) : countdown.target_date}T00:00:00`) : null;
    if (!date) return;
    revealedCreateRef.current = createdId;
    if (modeRef.current === "day") setSelectedDate(dateOnly(date));
    else if (modeRef.current === "week" && !visibleWeekDays(weekDaysOf(cursorRef.current, weekStart), showWeekends)
      .some((day) => isSameDay(day, date))) {
      setCursor(dateOnly(date)); setSelectedDate(dateOnly(date));
    } else if (modeRef.current === "month" && !monthCellsForView(cursorRef.current, weekStart, showWeekends).some((cell) => isSameDay(cell.date, date))) {
      setCursor(new Date(date.getFullYear(), date.getMonth(), 1)); setSelectedDate(dateOnly(date));
    }
  }, [createdId, tasks, countdowns, weekStart, showWeekends]);
  const scheduledTasks = useMemo(() => tasks.filter((task) => getTaskDate(task)), [tasks]);
  const monthTasks = useMemo(() => {
    if (mode === "year") return scheduledTasks;
    const from = mode === "week" ? weekDays[0] : mode === "day" ? selectedDate : mode === "agenda" ? cursor : cells[0].date;
    const last = mode === "week" ? weekDays[weekDays.length - 1] : mode === "day" ? selectedDate : mode === "agenda" ? shiftCalendarDay(cursor, agendaRangeDays - 1) : cells[cells.length - 1].date;
    return projectRecurringTasks(scheduledTasks, from, shiftCalendarDay(last, 1));
  }, [scheduledTasks, mode, weekDays, selectedDate, cells, cursor, agendaRangeDays]);
  // 日程视图：按天分组（含重复投影与倒数日）+ 顶部「已逾期」组（范围外的逾期任务，不重复列）。
  const agendaDaysList = useMemo(() => {
    if (mode !== "agenda") return [];
    return buildRangeAgenda(
      monthTasks,
      countdownsInRange(countdowns, cursor, shiftCalendarDay(cursor, agendaRangeDays - 1)),
      cursor,
      agendaRangeDays
    );
  }, [mode, monthTasks, countdowns, cursor, agendaRangeDays]);
  const agendaOverdueTasks = useMemo(() => {
    if (mode !== "agenda") return [];
    return buildOverdueAgendaTasks(scheduledTasks, cursor, isTaskOverdue);
  }, [mode, scheduledTasks, cursor]);
  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < cells.length; i += colCount) result.push(cells.slice(i, i + colCount).map((c) => c.date));
    return result;
  }, [cells, colCount]);
  // 可见范围内是否还有任务：筛选生效但本范围为空时给出轻提示（年视图按任务起止与年份相交判断）。
  const visibleRangeHasTasks = useMemo(() => {
    if (mode !== "year") return monthTasks.length > 0;
    const year = cursor.getFullYear();
    return monthTasks.some((task) => {
      const start = getTaskDate(task);
      if (!start) return false;
      const end = task.schedule_end_at ? new Date(task.schedule_end_at) : start;
      return start.getFullYear() <= year && end.getFullYear() >= year;
    });
  }, [mode, monthTasks, cursor]);
  const weekLayouts = useMemo(
    () => weeks.map((week) => layoutWeekSegments(monthTasks, week, createdId)),
    [weeks, monthTasks, createdId]
  );

  /* ---- 任务右键 / 长按 / 键盘菜单：单例菜单 + 根容器事件委托 ----
     各视图条目只带 data-calendar-task-id；contextmenu / 键盘走根容器冒泡，
     长按走根容器 capture（条目自己的 pointerdown 会 stopPropagation 启动拖拽）。 */
  const [taskMenu, setTaskMenu] = useState<CalendarTaskMenuRequest | null>(null);
  const taskMenuNonceRef = useRef(0);
  const openTaskMenu = useCallback((task: TaskWithTags, position: { x: number; y: number }, keyboard = false) => {
    taskMenuNonceRef.current += 1;
    setTaskMenu({ task, x: position.x, y: position.y, keyboard, nonce: taskMenuNonceRef.current });
  }, []);
  // 覆盖全部视图渲染的任务；TimeGridView 内部生成的重复投影 id 确定性一致，可直接按 id 命中
  const taskById = useMemo(() => {
    const map = new Map<string, TaskWithTags>();
    for (const task of scheduledTasks) map.set(task.id, task);
    for (const task of monthTasks) map.set(task.id, task);
    return map;
  }, [scheduledTasks, monthTasks]);
  const resolveTaskById = useCallback((id: string) => taskById.get(id) ?? null, [taskById]);
  const handleTaskContextMenu = useCallback((event: React.MouseEvent) => {
    const id = findCalendarTaskId(event.target);
    if (!id) return;
    const task = taskById.get(id);
    if (!task) return;
    event.preventDefault();
    event.stopPropagation();
    openTaskMenu(task, { x: event.clientX, y: event.clientY });
  }, [openTaskMenu, taskById]);
  const taskLongPress = useTaskLongPress(openTaskMenu, resolveTaskById);
  const handleTaskKeyDown = useCallback((event: React.KeyboardEvent) => {
    const id = findCalendarTaskId(event.target);
    if (!id) return;
    const task = taskById.get(id);
    if (!task) return;
    const projected = isRecurringProjection(task);
    handleCalendarTaskKeyDown(event, task, {
      onToggleDone: !projected && onToggleTaskDone ? (item) => onToggleTaskDone(recurringSource(item)) : undefined,
      onDelete: !projected && onDeleteTask ? (item) => onDeleteTask(recurringSource(item).id) : undefined,
      onOpenMenu: (item, position) => openTaskMenu(item, position, true),
    });
  }, [onDeleteTask, onToggleTaskDone, openTaskMenu, taskById]);
  const taskMenuActions = useMemo<CalendarTaskMenuActions>(() => ({
    onOpenDetail: (task) => onTaskClick?.(recurringSource(task)),
    onToggleDone: onToggleTaskDone ? (task) => onToggleTaskDone(recurringSource(task)) : undefined,
    onReschedule: onRescheduleTaskShortcut ? (task, shortcut) => onRescheduleTaskShortcut(recurringSource(task), shortcut) : undefined,
    onDuplicate: onDuplicateTask ? (task) => onDuplicateTask(recurringSource(task)) : undefined,
    onDelete: onDeleteTask ? (task) => onDeleteTask(recurringSource(task).id) : undefined,
  }), [onDeleteTask, onDuplicateTask, onRescheduleTaskShortcut, onTaskClick, onToggleTaskDone]);

  // 手机月视图「今天」/ 再次点同一天时递增，让议程重新滚到目标分组。
  const [agendaFocusNonce, setAgendaFocusNonce] = useState(0);

  const monthCountdowns = useMemo(() => {
    const first = cells[0]?.date ?? cursor;
    const last = cells[cells.length - 1]?.date ?? cursor;
    return countdownsInRange(countdowns, first, last);
  }, [cells, countdowns, cursor]);
  const yearCountdowns = useMemo(
    () => countdownsInRange(countdowns, new Date(cursor.getFullYear(), 0, 1), new Date(cursor.getFullYear(), 11, 31)),
    [countdowns, cursor]
  );
  // 手机周日期条圆点：盖住当天的任务（含跨天、重复投影）+ 当天倒数日
  const weekMarkers = useMemo(
    () => calendarDayMarkers(monthTasks, countdownsInRange(countdowns, weekDays[0], weekDays[weekDays.length - 1]), weekDays),
    [monthTasks, countdowns, weekDays]
  );

  const step = (direction: -1 | 1) => {
    setAgendaExtraPages(0);
    const currentMode = modeRef.current;
    const currentCursor = cursorRef.current;
    const currentSelected = selectedRef.current;
    if (currentMode === "day") {
      const next = new Date(currentSelected.getFullYear(), currentSelected.getMonth(), currentSelected.getDate() + direction);
      const nextCursor = new Date(next.getFullYear(), next.getMonth(), 1);
      selectedRef.current = next;
      cursorRef.current = nextCursor;
      setSelectedDate(next);
      setCursor(nextCursor);
    } else if (currentMode === "week") {
      const nextCursor = new Date(currentCursor.getFullYear(), currentCursor.getMonth(), currentCursor.getDate() + direction * 7);
      // M06：手机周视图的议程页跟随翻页周（selectedDate 始终落在可见周内）
      const nextSelected = new Date(currentSelected.getFullYear(), currentSelected.getMonth(), currentSelected.getDate() + direction * 7);
      cursorRef.current = nextCursor;
      selectedRef.current = nextSelected;
      setCursor(nextCursor);
      setSelectedDate(nextSelected);
    } else if (currentMode === "agenda") {
      // 日程视图按 30 天平移范围；selectedDate 跟随范围首日（切走时的对齐基准）。
      const nextCursor = shiftCalendarDay(currentCursor, direction * AGENDA_PAGE_DAYS);
      cursorRef.current = nextCursor;
      selectedRef.current = nextCursor;
      setCursor(nextCursor);
      setSelectedDate(nextCursor);
    } else if (currentMode === "month") {
      const nextCursor = new Date(currentCursor.getFullYear(), currentCursor.getMonth() + direction, 1);
      const nextSelected = monthSelectionOnEntry(nextCursor, today, currentSelected);
      cursorRef.current = nextCursor;
      selectedRef.current = nextSelected;
      setCursor(nextCursor);
      setSelectedDate(nextSelected);
    } else {
      const nextCursor = new Date(currentCursor.getFullYear() + direction, currentCursor.getMonth(), 1);
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
    }
  };
  const goToday = () => {
    setAgendaExtraPages(0);
    const nextSelected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const nextCursor = new Date(today.getFullYear(), today.getMonth(), modeRef.current === "week" || modeRef.current === "agenda" ? today.getDate() : 1);
    selectedRef.current = nextSelected;
    cursorRef.current = nextCursor;
    setSelectedDate(nextSelected);
    setCursor(nextCursor);
    setAgendaFocusNonce((nonce) => nonce + 1);
  };
  /** 手机迷你月历点某天：选中它；点到相邻月的补位日期时同时翻到那个月。 */
  const selectMobileDate = (date: Date) => {
    const day = dateOnly(date);
    selectedRef.current = day;
    setSelectedDate(day);
    if (day.getFullYear() !== cursorRef.current.getFullYear() || day.getMonth() !== cursorRef.current.getMonth()) {
      const nextCursor = new Date(day.getFullYear(), day.getMonth(), 1);
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
    }
    setAgendaFocusNonce((nonce) => nonce + 1);
  };
  const switchMode = (next: CalendarMode) => {
    if (next === modeRef.current) return;
    setAgendaExtraPages(0);
    if (next === "day") {
      const aligned = dateForDayView(modeRef.current, cursorRef.current, selectedRef.current);
      selectedRef.current = aligned;
      setSelectedDate(aligned);
    } else if (next === "week") {
      const aligned = dateForDayView(modeRef.current, cursorRef.current, selectedRef.current);
      cursorRef.current = aligned;
      selectedRef.current = aligned;
      setCursor(aligned);
      setSelectedDate(aligned);
    } else if (next === "agenda") {
      // 日程范围从当前选中日开始（月/年视图下 selectedDate 已对齐到 cursor 所在月）。
      const aligned = dateOnly(selectedRef.current);
      cursorRef.current = aligned;
      selectedRef.current = aligned;
      setCursor(aligned);
      setSelectedDate(aligned);
    } else if (next === "month") {
      const base = modeRef.current === "day" ? selectedRef.current : cursorRef.current;
      const nextCursor = new Date(base.getFullYear(), base.getMonth(), 1);
      const aligned = monthSelectionOnEntry(nextCursor, today, selectedRef.current);
      cursorRef.current = nextCursor;
      selectedRef.current = aligned;
      setCursor(nextCursor);
      setSelectedDate(aligned);
    }
    modeRef.current = next;
    setMode(next);
  };
  const runCalendarNav = (event: KeyboardEvent, action: CalendarNavAction) => {
    if (hasOpenDialog()) return;
    // 格子内的 ←/→ 只移动日期。t/d/w/m/y 仍在这里处理。弹层打开时上面的 hasOpenDialog 已挡住全部导航键。
    if ((action === "prev" || action === "next") && isMonthGridCellEventTarget(event.target)) return;
    event.preventDefault();
    if (action === "prev") step(-1);
    else if (action === "next") step(1);
    else if (action === "today") goToday();
    else switchMode(action);
  };
  const openDayView = (date: Date) => {
    const selected = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nextCursor = new Date(selected.getFullYear(), selected.getMonth(), 1);
    selectedRef.current = selected;
    cursorRef.current = nextCursor;
    modeRef.current = "day";
    pendingMonthFocusKey.current = null;
    setSelectedDate(selected);
    setCursor(nextCursor);
    setMode("day");
  };
  const moveMonthGridFocus = (next: Date) => {
    const day = new Date(next.getFullYear(), next.getMonth(), next.getDate());
    rovingRef.current = day;
    const current = cursorRef.current;
    if (day.getFullYear() !== current.getFullYear() || day.getMonth() !== current.getMonth()) {
      const nextCursor = new Date(day.getFullYear(), day.getMonth(), 1);
      cursorRef.current = nextCursor;
      setCursor(nextCursor);
    }
    pendingMonthFocusKey.current = keyFor(day);
    setRovingDate(day);
  };
  const onMonthCellKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, cellDate: Date) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    const isMove = key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";
    if (isMove && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      const base = pendingMonthFocusKey.current && rovingRef.current ? rovingRef.current : cellDate;
      if (key === "ArrowLeft") moveMonthGridFocus(shiftCalendarDay(base, -1));
      else if (key === "ArrowRight") moveMonthGridFocus(shiftCalendarDay(base, 1));
      else if (key === "ArrowUp") moveMonthGridFocus(shiftCalendarDay(base, -7));
      else if (key === "ArrowDown") moveMonthGridFocus(shiftCalendarDay(base, 7));
      else if (key === "Home") moveMonthGridFocus(weekStartOf(base, weekStart));
      else moveMonthGridFocus(shiftCalendarDay(weekStartOf(base, weekStart), colCount - 1));
      return;
    }
    if (event.target !== event.currentTarget) return;
    if (key === "Enter" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      openDayView(cellDate);
      return;
    }
    if ((key === "Enter" || key === " ") && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      onDateClick?.(cellDate, undefined, calendarCreateAnchor(event.currentTarget));
    }
  };
  useEffect(() => {
    if (mode !== "month") {
      pendingMonthFocusKey.current = null;
      return;
    }
    for (const [key, node] of monthCellRefs.current) {
      if (!node.isConnected) monthCellRefs.current.delete(key);
    }
    const key = pendingMonthFocusKey.current;
    if (!key) return;
    const node = monthCellRefs.current.get(key);
    if (!node) return;
    pendingMonthFocusKey.current = null;
    node.focus();
  }, [rovingDate, cursor, mode]);
  useHotkey([
    {
      key: "n", ctrlKey: false, metaKey: false, altKey: false, preventDefault: false,
      handler: (event) => {
        if (!onDateClick || hasOpenDialog() || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
        event.preventDefault();
        const month = modeRef.current === "month" || modeRef.current === "year" || modeRef.current === "agenda";
        const mobile = window.matchMedia?.("(max-width: 767px)").matches;
        const date = new Date(modeRef.current === "month" && !mobile ? activeRovingDate : selectedRef.current);
        date.setHours(month ? 0 : new Date().getHours() + 1, 0, 0, 0);
        const focusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        if (!month) {
          const selected = dateOnly(date);
          selectedRef.current = selected;
          setSelectedDate(selected);
          if (modeRef.current === "week" && !visibleWeekDays(weekDaysOf(cursorRef.current, weekStart), showWeekends)
            .some((day) => isSameDay(day, date))) {
            cursorRef.current = selected;
            setCursor(selected);
          }
        }
        // Resolve the anchor after any date/week navigation has rendered its target column.
        setKeyboardCreate({ date, timed: !month, focusTarget });
      },
    },
    { key: "arrowleft", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: false, handler: (event) => runCalendarNav(event, "prev") },
    { key: "arrowright", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: false, handler: (event) => runCalendarNav(event, "next") },
    { key: "t", ctrlKey: false, metaKey: false, altKey: false, preventDefault: false, handler: (event) => runCalendarNav(event, "today") },
    { key: "d", ctrlKey: false, metaKey: false, altKey: false, preventDefault: false, handler: (event) => runCalendarNav(event, "day") },
    { key: "w", ctrlKey: false, metaKey: false, altKey: false, preventDefault: false, handler: (event) => runCalendarNav(event, "week") },
    { key: "m", ctrlKey: false, metaKey: false, altKey: false, preventDefault: false, handler: (event) => runCalendarNav(event, "month") },
    { key: "y", ctrlKey: false, metaKey: false, altKey: false, preventDefault: false, handler: (event) => runCalendarNav(event, "year") },
    { key: "a", ctrlKey: false, metaKey: false, altKey: false, preventDefault: false, handler: (event) => runCalendarNav(event, "agenda") },
  ]);

  useEffect(() => {
    // The mobile shell delegates here so selection, preview and saving share the page's onDateClick path.
    const create = (event: Event) => {
      if (!onDateClick || hasOpenDialog()) return;
      const date = calendarAddDate(modeRef.current, cursorRef.current, new Date(), selectedRef.current, weekDays);
      selectedRef.current = date;
      setSelectedDate(date);
      const focusTarget = (event as CustomEvent<{ focusTarget?: HTMLElement }>).detail?.focusTarget;
      onDateClick(date, undefined, focusTarget ? calendarCreateAnchor(focusTarget) : undefined);
    };
    window.addEventListener("organize:calendar-create", create);
    return () => window.removeEventListener("organize:calendar-create", create);
  }, [onDateClick, weekDays]);

  useEffect(() => {
    if (!keyboardCreate || !onDateClick) return;
    const { date, timed, focusTarget } = keyboardCreate;
    const cell = timed ? document.querySelector<HTMLElement>(`[data-time-grid-day="${keyFor(date)}"]`) : monthCellRefs.current.get(keyFor(date));
    let anchor: CalendarCreateAnchor = cell ? calendarCreateAnchor(cell) : { focusTarget };
    if (cell && timed) {
      const scroller = cell.parentElement?.parentElement?.parentElement;
      if (scroller) scroller.scrollTop = Math.max(0, date.getHours() * HOUR_HEIGHT - HOUR_HEIGHT);
      const rect = cell.getBoundingClientRect();
      anchor = calendarCreateAnchor(cell, new DOMRect(rect.x, rect.y + date.getHours() * HOUR_HEIGHT, rect.width, HOUR_HEIGHT));
    }
    setKeyboardCreate(null);
    onDateClick(date, timed ? new Date(date.getTime() + 3_600_000) : undefined, anchor);
  }, [keyboardCreate, onDateClick]);

  const title =
    mode === "year" ? `${cursor.getFullYear()}年`
    : mode === "month" ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
    : mode === "agenda"
      ? (() => {
          const last = shiftCalendarDay(cursor, agendaRangeDays - 1);
          const head = `${cursor.getMonth() + 1}月${cursor.getDate()}日`;
          const tail =
            cursor.getMonth() === last.getMonth()
              ? `${last.getDate()}日`
              : `${last.getMonth() + 1}月${last.getDate()}日`;
          return `${head} - ${tail}`;
        })()
    : mode === "week"
      ? (() => {
          const first = weekDays[0];
          const last = weekDays[weekDays.length - 1];
          const head = `${first.getMonth() + 1}月${first.getDate()}日`;
          const tail =
            first.getMonth() === last.getMonth()
              ? `${last.getDate()}日`
              : `${last.getMonth() + 1}月${last.getDate()}日`;
          return `${head} - ${tail}`;
        })()
    : `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 ${WEEKDAYS[(selectedDate.getDay() + 6) % 7]}`;

  const startMonthDrag = (event: React.PointerEvent<HTMLButtonElement>, task: TaskWithTags, lane: number) => {
    if (isRecurringProjection(task) || !onRescheduleTask || event.button !== 0 || !event.isPrimary || monthDragRef.current) return;
    const originalStart = getTaskDate(task);
    if (!originalStart) return;
    event.stopPropagation();
    suppressMonthClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next: MonthDragState = {
      task, originalStart, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, lane, moved: false, target: null,
    };
    monthDragRef.current = next;
    setMonthDrag(next);
  };

  const moveMonthDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = monthDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // 续段可出现在原 start 日之后；轻点或手抖不能把整段平移到续段当天。
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 5;
    let target: Date | null = null;
    const gridRect = monthGridRef.current?.getBoundingClientRect();
    if (moved && gridRect && event.clientY >= gridRect.top && event.clientY < gridRect.bottom) {
      // capture 后 event.currentTarget 始终是源按钮，必须按实际周行矩形命中跨周落点。
      for (let i = 0; i < weeks.length; i += 1) {
        const rect = monthRowsRef.current[i]?.getBoundingClientRect();
        if (rect && rect.width > 0 && event.clientY >= rect.top && event.clientY < rect.bottom) {
          target = weeks[i][monthColFromClientX(event.clientX, rect.left, rect.width, colCount)];
          break;
        }
      }
    }
    if (current.moved !== moved || current.target?.getTime() !== target?.getTime()) {
      const next = { ...current, moved, target };
      monthDragRef.current = next;
      setMonthDrag(next);
    }
  };

  const clearMonthDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    monthDragRef.current = null;
    setMonthDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const endMonthDrag = async (event: React.PointerEvent<HTMLButtonElement>) => {
    if (monthDragRef.current?.pointerId !== event.pointerId) return;
    moveMonthDrag(event);
    const current = monthDragRef.current!;
    const changed = current.target !== null && !isSameDay(current.target, current.originalStart);
    // 放回原日保留 click；改期或拖出网格则吞掉随后的 click，防止打开详情。
    suppressMonthClickRef.current = current.moved && (changed || current.target === null);
    clearMonthDrag(event);
    if (changed && current.target && onRescheduleTask) {
      await onRescheduleTask(current.task.id, monthRescheduleTargetDate(current.target, current.originalStart));
    }
  };

  const cancelMonthDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (monthDragRef.current?.pointerId !== event.pointerId) return;
    suppressMonthClickRef.current = true;
    clearMonthDrag(event);
  };

  /* ---- 月格空白拖选新建跨天全天：轻点仍走 click 建单日，拖过阈值后按周行矩形跨行取日。 ---- */
  const clearMonthCreate = useCallback(() => {
    const current = monthCreateRef.current;
    monthCreateRef.current = null;
    setMonthCreate(null);
    if (current?.cell.hasPointerCapture(current.pointerId)) current.cell.releasePointerCapture(current.pointerId);
  }, []);

  const cancelMonthCreate = useCallback(() => {
    if (!monthCreateRef.current) return;
    suppressMonthCreateClickRef.current = true;
    clearMonthCreate();
  }, [clearMonthCreate]);

  // 翻页 / 切模式会重建格子，捕获元素卸载后收不到 lostpointercapture，这里兜底清理。
  useEffect(() => { cancelMonthCreate(); }, [cells, mode, cancelMonthCreate]);
  useHotkey(monthCreate ? [{ key: "Escape", handler: cancelMonthCreate, allowInInput: true }] : []);

  const startMonthCreate = (event: React.PointerEvent<HTMLDivElement>, date: Date) => {
    // 日期数字、+N、倒数日 chip 与任务条都自行 stopPropagation；这里再挡一次，连同非主键和进行中的手势。
    if (!onDateClick || event.button !== 0 || !event.isPrimary || monthCreateRef.current || monthDragRef.current ||
        (event.target as HTMLElement).closest("button, input, [role='button'], [role='checkbox'], [data-calendar-task-id]")) return;
    suppressMonthCreateClickRef.current = false;
    const cell = event.currentTarget;
    cell.setPointerCapture(event.pointerId);
    const next: MonthCreateDragState = {
      pointerId: event.pointerId, cell, startX: event.clientX, startY: event.clientY,
      anchorDate: date, targetDate: date, moved: false,
    };
    monthCreateRef.current = next;
    setMonthCreate(next);
  };

  const moveMonthCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = monthCreateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= DRAG_CREATE_MOVE_PX;
    let targetDate = current.targetDate;
    if (moved) {
      // capture 后 currentTarget 始终是起点格子，按周行矩形命中跨行落点；拖出网格夹到首末行 / 列。
      const rowRects = monthRowsRef.current.slice(0, weeks.length).map((row) => row?.getBoundingClientRect());
      const rowIndex = dragCreateRowIndex(rowRects, event.clientY);
      const rect = rowIndex >= 0 ? rowRects[rowIndex] : undefined;
      if (rect && rect.width > 0) targetDate = weeks[rowIndex][monthColFromClientX(event.clientX, rect.left, rect.width, colCount)];
    }
    if (current.moved !== moved || current.targetDate.getTime() !== targetDate.getTime()) {
      const next = { ...current, moved, targetDate };
      monthCreateRef.current = next;
      setMonthCreate(next);
    }
  };

  const endMonthCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    if (monthCreateRef.current?.pointerId !== event.pointerId) return;
    moveMonthCreate(event);
    const current = monthCreateRef.current!;
    clearMonthCreate();
    if (!current.moved) return; // 轻点仍由 click 建单日全天。
    suppressMonthCreateClickRef.current = true;
    const range = dragCreateDayRange(current.anchorDate, current.targetDate);
    const first = monthCellRefs.current.get(keyFor(range.start)) ?? current.cell;
    const last = monthCellRefs.current.get(keyFor(range.end)) ?? current.cell;
    const union = unionRect(first.getBoundingClientRect(), last.getBoundingClientRect());
    setSelectedDate(range.start);
    setRovingDate(range.start);
    rovingRef.current = range.start;
    onDateClick?.(
      range.start,
      isSameDay(range.start, range.end) ? undefined : range.end,
      calendarCreateAnchor(first, new DOMRect(union.x, union.y, union.width, union.height)),
      true
    );
  };

  const cancelMonthCreateForEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    if (monthCreateRef.current?.pointerId === event.pointerId) cancelMonthCreate();
  };

  const monthCreateFirstRow = monthCreateRange ? weeks.findIndex((week) => dragCreateWeekColumns(week, monthCreateRange)) : -1;

  /* ---- 未排期托盘拖入月格：落点（网格外为 null）、上报与预览 ---- */
  const unscheduledMonthDate = useMemo(() => {
    if (mode !== "month" || !unscheduledDrag?.moved) return null;
    return resolveMonthDropTarget({
      gridRect: monthGridRef.current?.getBoundingClientRect() ?? null,
      rowRects: weeks.map((_, index) => monthRowsRef.current[index]?.getBoundingClientRect() ?? null),
      weeks,
      colCount,
      clientX: unscheduledDrag.clientX,
      clientY: unscheduledDrag.clientY,
    });
  }, [mode, unscheduledDrag, weeks, colCount]);
  const unscheduledMonthKey = unscheduledMonthDate ? keyFor(unscheduledMonthDate) : null;

  useEffect(() => {
    if (mode !== "month") return;
    onUnscheduledDragTarget?.(unscheduledMonthDate ? { zone: "all-day", date: unscheduledMonthDate } : null);
  }, [mode, unscheduledMonthDate, onUnscheduledDragTarget]);


  return (
    <div
      className="organize-task-month-view flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      onContextMenu={handleTaskContextMenu}
      onKeyDown={handleTaskKeyDown}
      {...taskLongPress}
    >
      {/* 手机（<md）两行：第一行 标题 + 上一页/今天/下一页，第二行全宽分段模式切换；
          桌面仍是一行，模式分段靠 md:ml-auto 贴到导航组左侧，间距由 header gap-3 提供（= 原 mr-2 + gap-1） */}
      <header className="task-calendar-header flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 text-base font-semibold">{title}</h2>
        <div role="group" aria-label="日历视图" className="order-last flex basis-full rounded-lg bg-muted p-1 text-sm md:order-none md:ml-auto md:basis-auto">
          {(["day", "week", "month", "year", "agenda"] as CalendarMode[]).map((item) => (
            <Button
              key={item}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => switchMode(item)}
              aria-pressed={mode === item}
              title={CALENDAR_MODE_TITLE[item]}
              className={cn("flex-1 md:flex-none", mode === item ? "bg-background font-medium" : "text-muted-foreground")}
            >
              {item === "day" ? "日" : item === "week" ? "周" : item === "month" ? "月" : item === "year" ? "年" : "日程"}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
          <Button type="button" variant="outline" size="icon" aria-label="上一页" title="上一页（←）" onClick={() => step(-1)}><ChevronLeft className="h-5 w-5" /></Button>
          <Button type="button" variant="outline" size="sm" title="今天（t）" onClick={goToday} className="shrink-0">今天</Button>
          <Button type="button" variant="outline" size="icon" aria-label="下一页" title="下一页（→）" onClick={() => step(1)}><ChevronRight className="h-5 w-5" /></Button>
          {toolbarAction}
          {onViewOptionsChange && (
            <CalendarViewOptionsMenu options={viewOptions ?? DEFAULT_CALENDAR_VIEW_OPTIONS} onChange={onViewOptionsChange} />
          )}
        </div>
      </header>

      {calendarFilterBar}
      {calendarFilterActive && !visibleRangeHasTasks && (
        <CalendarFilterEmptyHint onClear={onClearCalendarFilter} />
      )}

      {mode === "week" && (
        <>
          {/* M06：手机上周历七列每列仅 ~44px，降级为「日期条 + 当日议程」；
              桌面保持七列时间网格（拖拽排期）不变。日期条与议程一起可左右滑动翻周。 */}
          <CalendarSwipeSurface onSwipeStep={step} className="flex min-h-0 flex-1 flex-col md:hidden" data-calendar-surface="mobile-week">
            <div className={cn("grid shrink-0 gap-1 border-b px-3 py-2", weekDays.length === 5 ? "grid-cols-5" : "grid-cols-7")}>
              {weekDays.map((day) => {
                const active = isSameDay(day, selectedDate);
                const isToday = isSameDay(day, today);
                const marker = weekMarkers.get(keyFor(day));
                const summary = [
                  marker && marker.tasks > 0 ? `${marker.tasks} 个任务` : "",
                  marker && marker.countdowns > 0 ? `${marker.countdowns} 个倒数日` : "",
                ].filter(Boolean).join("，");
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    aria-pressed={active}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${day.getMonth() + 1}月${day.getDate()}日 ${WEEK_DAY_LABELS[(day.getDay() + 6) % 7]}${isToday ? "，今天" : ""}${summary ? `，${summary}` : ""}`}
                    className={cn(
                      "flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-xs",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      isToday && !active && "font-semibold text-foreground ring-1 ring-inset ring-primary"
                    )}
                  >
                    <span>{WEEK_DAY_LABELS[(day.getDay() + 6) % 7].replace("周", "")}</span>
                    <span className={cn("text-sm font-medium tabular-nums", active && "font-semibold")}>{day.getDate()}</span>
                    <span className="flex h-1 items-center gap-0.5" aria-hidden="true">
                      {marker && marker.tasks > 0 && <span data-marker="task" className={cn("h-1 w-1 rounded-full", active ? "bg-primary-foreground" : "bg-primary")} />}
                      {marker && marker.countdowns > 0 && <span data-marker="countdown" className={cn("h-1 w-1 rounded-full", active ? "bg-primary-foreground" : "bg-muted-foreground")} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DayView
                date={selectedDate}
                createPreview={createPreview}
                createdId={createdId}
                tasks={monthTasks}
                countdowns={countdowns}
                onTaskClick={onTaskClick}
                onToggleTaskDone={onToggleTaskDone}
                onUpdateTaskSchedule={onUpdateTaskSchedule}
                onRescheduleTask={onRescheduleTask}
                onAdd={onDateClick ? () => onDateClick(selectedDate) : undefined}
              />
            </div>
          </CalendarSwipeSurface>
          <div className="hidden min-h-0 flex-1 md:flex md:flex-col">
            <TimeGridView
              days={weekDays}
              tasks={scheduledTasks}
              countdowns={countdowns}
              onTaskClick={onTaskClick}
              onToggleTaskDone={onToggleTaskDone}
              onUpdateTaskSchedule={onUpdateTaskSchedule}
              onDateClick={onDateClick}
              createPreview={createPreview}
              createdId={createdId}
              onOpenDay={openDayView}
              unscheduledDrag={unscheduledDrag}
              onUnscheduledDragTarget={onUnscheduledDragTarget}
              onTaskContextMenu={(task, event) => {
                event.preventDefault();
                event.stopPropagation();
                openTaskMenu(task, { x: event.clientX, y: event.clientY });
              }}
            />
          </div>
        </>
      )}

      {mode === "month" && (
        <>
          <div data-calendar-month-header className={cn("hidden shrink-0 border-b bg-muted/20 md:grid", colCount === 5 ? "grid-cols-5" : "grid-cols-7")}>
            {weeks[0].map((day) => <div key={day.toISOString()} className="border-r px-2 py-3 text-center text-sm text-muted-foreground last:border-r-0">{weekdayLabel(day)}</div>)}
          </div>
          <div
            ref={monthGridRef}
            role="grid"
            data-calendar-surface="month"
            data-countdown-surface="month"
            aria-label={`${cursor.getFullYear()}年${cursor.getMonth() + 1}月`}
            className="hidden min-h-0 flex-1 flex-col overflow-y-auto md:flex"
          >
            {weeks.map((week, weekIndex) => {
              const { segments, hiddenByCol } = weekLayouts[weekIndex];
              const createCols = monthCreateRange ? dragCreateWeekColumns(week, monthCreateRange) : null;
              return (
                <div
                  key={keyFor(week[0])}
                  role="row"
                  ref={(node) => { monthRowsRef.current[weekIndex] = node; }}
                  className={cn("relative grid flex-1", colCount === 5 ? "grid-cols-5" : "grid-cols-7")}
                  style={{ minHeight: DAY_HEADER_PX + MAX_LANES * LANE_HEIGHT_PX + COUNTDOWN_STRIP_PX + 8 }}
                >
                  {week.map((date, col) => {
                    const inMonth = cells[weekIndex * colCount + col].inMonth;
                    const cellKey = keyFor(date);
                    const dayCountdowns = [...(monthCountdowns.get(cellKey) || [])].sort((a, b) => Number(b.id === createdId) - Number(a.id === createdId));
                    const moreCount = monthCellOverflowCount(hiddenByCol[col], dayCountdowns.length);
                    const dayTasks = moreCount > 0 ? tasksOnDay(monthTasks, date) : [];
                    const isRoving = keyFor(date) === keyFor(activeRovingDate);
                    const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`;
                    const isToday = isSameDay(date, today);
                    const inCreateRange = !!monthCreateRange && isDayInDragCreateRange(date, monthCreateRange);
                    return (
                      <div
                        key={cellKey}
                        data-countdown-date={countdownDateKey(date)}
                        data-calendar-drag-create={inCreateRange ? "month" : undefined}
                        role="gridcell"
                        tabIndex={isRoving ? 0 : -1}
                        aria-label={dateLabel}
                        ref={(node) => {
                          if (node) monthCellRefs.current.set(cellKey, node);
                        }}
                        onClick={onDateClick ? (event) => {
                          // 拖选松手后的兼容 click 已由拖选建卡，这里吞掉；轻点仍建单日全天。
                          if (suppressMonthCreateClickRef.current) {
                            suppressMonthCreateClickRef.current = false;
                            return;
                          }
                          setSelectedDate(date); setRovingDate(date); rovingRef.current = date;
                          onDateClick(date, undefined, calendarCreateAnchor(event.currentTarget));
                        } : undefined}
                        onPointerDown={onDateClick ? (event) => startMonthCreate(event, date) : undefined}
                        onPointerMove={onDateClick ? moveMonthCreate : undefined}
                        onPointerUp={onDateClick ? endMonthCreate : undefined}
                        onPointerCancel={onDateClick ? cancelMonthCreateForEvent : undefined}
                        onLostPointerCapture={onDateClick ? cancelMonthCreateForEvent : undefined}
                        onKeyDown={(event) => onMonthCellKeyDown(event, date)}
                        className={cn(
                          "relative border-b border-r p-1.5 last:border-r-0",
                          MONTH_CELL_FOCUS,
                          createPreview && calendarCreatePreviewOnDay(createPreview, date) && "bg-accent ring-2 ring-inset ring-primary",
                          onDateClick && "cursor-pointer select-none hover:bg-muted/40",
                          !inMonth && "bg-muted/20 text-muted-foreground",
                          isToday && "bg-accent/70",
                          (dragOverDate === cellKey || countdownDragDate === countdownDateKey(date)) && "bg-primary/10 ring-2 ring-inset ring-primary",
                          unscheduledMonthKey === cellKey && "bg-primary/10 ring-2 ring-inset ring-primary",
                          inCreateRange && "bg-primary/10",
                        )}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          tabIndex={isRoving ? 0 : -1}
                          aria-label={`打开 ${dateLabel} 日视图`}
                          onClick={(event) => {
                            event.stopPropagation();
                            openDayView(date);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                          }}
                          className={cn(
                            "h-7 w-7 min-h-0 min-w-0 rounded-full p-0 text-sm font-normal md:h-7 md:w-7 md:min-h-0 md:min-w-0",
                            isToday && "bg-primary font-semibold text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                          )}
                        >
                          {date.getDate()}
                        </Button>
                        {createPreview && calendarCreatePreviewOnDay(createPreview, date) && <span data-calendar-create-preview="month" className="pointer-events-none absolute inset-x-1.5 top-8 z-20 truncate rounded border border-dashed border-primary bg-background px-1 text-xs">{createPreview.title || "新事项"}</span>}
                        <div className="absolute inset-x-1.5 bottom-1 flex items-center gap-1">
                          {dayCountdowns[0] && <span data-calendar-created={dayCountdowns[0].id === createdId || undefined}><CountdownChip item={dayCountdowns[0]} /></span>}
                          {moreCount > 0 && (
                            <MonthDayPopover
                              date={date}
                              tasks={dayTasks}
                              countdowns={dayCountdowns}
                              moreCount={moreCount}
                              tabIndex={isRoving ? 0 : -1}
                              onOpenDay={() => openDayView(date)}
                              onTaskClick={onTaskClick}
                              onToggleTaskDone={onToggleTaskDone}
                              onTaskContextMenu={(task, event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openTaskMenu(task, { x: event.clientX, y: event.clientY });
                              }}
                              onAdd={onDateClick ? () => { const cell = monthCellRefs.current.get(keyFor(date)); onDateClick(date, undefined, cell ? calendarCreateAnchor(cell) : undefined); } : undefined}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* 跨天任务连续条（绝对定位叠加在周行上） */}
                  {segments.map((seg) => (
                    <button
                      type="button"
                      key={`${seg.task.id}-${weekIndex}`}
                      {...recurringPresentation(seg.task)}
                      data-calendar-created={seg.task.id === createdId || undefined}
                      data-calendar-task-id={seg.task.id}
                      onPointerDown={(event) => startMonthDrag(event, seg.task, seg.lane)}
                      onPointerMove={moveMonthDrag}
                      onPointerUp={endMonthDrag}
                      onPointerCancel={cancelMonthDrag}
                      onLostPointerCapture={cancelMonthDrag}
                      onClick={(event) => {
                        event.stopPropagation();
                        const suppressed = suppressMonthClickRef.current;
                        suppressMonthClickRef.current = false;
                        if (suppressed && event.detail > 0) {
                          event.preventDefault();
                          return;
                        }
                        onTaskClick?.(recurringSource(seg.task));
                      }}
                      className={cn(
                        "absolute z-10 flex items-center gap-1 px-1.5 text-left text-xs transition-colors hover:brightness-95",
                        onRescheduleTask && !isRecurringProjection(seg.task) && "cursor-grab select-none active:cursor-grabbing",
                        categoryClass(seg.task),
                        !seg.continuesBefore && "rounded-l",
                        !seg.continuesAfter && "rounded-r",
                        monthDrag?.moved && monthDrag.task.id === seg.task.id && "opacity-40"
                      )}
                      style={{
                        touchAction: onRescheduleTask && !isRecurringProjection(seg.task) ? "none" : "auto",
                        top: DAY_HEADER_PX + seg.lane * LANE_HEIGHT_PX + 2,
                        height: LANE_HEIGHT_PX - 4,
                        left: `calc(${(seg.startCol / colCount) * 100}% + ${seg.continuesBefore ? 0 : 2}px)`,
                        width: `calc(${((seg.endCol - seg.startCol + 1) / colCount) * 100}% - ${(seg.continuesBefore ? 0 : 2) + (seg.continuesAfter ? 0 : 2)}px)`,
                      }}
                    >
                      {!seg.continuesBefore && (
                        <CalendarTaskCheckbox task={seg.task} onToggle={onToggleTaskDone} />
                      )}
                      <span className="min-w-0 flex-1 truncate"><TaskRepeatIcon task={seg.task} />{seg.task.title}</span>
                      {!seg.continuesAfter && timeLabel(seg.task) && <span className="shrink-0 text-[10px] opacity-70">{timeLabel(seg.task)}</span>}
                    </button>
                  ))}
                  {monthDrag?.moved && week.map((date, col) => dragOverDate === keyFor(date) && (
                    <div
                      key={`ghost-${col}`}
                      aria-hidden="true"
                      className="pointer-events-none absolute z-20 truncate rounded border-2 border-dashed border-primary/40 bg-primary/5 px-1.5 text-xs text-foreground"
                      style={{
                        top: DAY_HEADER_PX + monthDrag.lane * LANE_HEIGHT_PX + 2,
                        height: LANE_HEIGHT_PX - 4,
                        left: `calc(${(col / colCount) * 100}% + 2px)`,
                        width: `calc(${100 / colCount}% - 4px)`,
                      }}
                    >
                      {monthDrag.task.title}
                    </div>
                  ))}
                  {/* 未排期托盘拖入月格的落点幽灵条：目标列第一条空闲泳道 */}
                  {unscheduledMonthKey && unscheduledDrag && (() => {
                    const col = week.findIndex((date) => keyFor(date) === unscheduledMonthKey);
                    if (col < 0) return null;
                    const lane = firstFreeLaneForSegments(segments, col);
                    return (
                      <div
                        aria-hidden="true"
                        data-drop-placeholder-source="tray"
                        className="pointer-events-none absolute z-20 truncate rounded border-2 border-dashed border-primary/40 bg-primary/5 px-1.5 text-xs text-foreground"
                        style={{
                          top: DAY_HEADER_PX + lane * LANE_HEIGHT_PX + 2,
                          height: LANE_HEIGHT_PX - 4,
                          left: `calc(${(col / colCount) * 100}% + 2px)`,
                          width: `calc(${100 / colCount}% - 4px)`,
                        }}
                      >
                        {unscheduledDrag.task.title}
                      </div>
                    );
                  })()}
                  {/* 拖选新建的即时区间条：每周行一段，跨周行时只有首段向读屏播报 */}
                  {createCols && monthCreateRange && (
                    <div
                      role={weekIndex === monthCreateFirstRow ? "status" : undefined}
                      aria-hidden={weekIndex === monthCreateFirstRow ? undefined : true}
                      data-calendar-drag-create-bar="month"
                      className="pointer-events-none absolute z-20 truncate rounded border border-dashed border-primary bg-background px-1.5 text-xs font-medium"
                      style={{
                        top: DAY_HEADER_PX + 2,
                        height: LANE_HEIGHT_PX - 4,
                        left: `calc(${(createCols.startCol / colCount) * 100}% + 2px)`,
                        width: `calc(${((createCols.endCol - createCols.startCol + 1) / colCount) * 100}% - 4px)`,
                      }}
                    >
                      {dragCreateRangeLabel(monthCreateRange)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <MobileMonthView
            cursor={cursor}
            today={today}
            selectedDate={selectedDate}
            tasks={monthTasks}
            countdownsByDay={monthCountdowns}
            focusNonce={agendaFocusNonce}
            weekStart={weekStart}
            showWeekends={showWeekends}
            onSelectDate={selectMobileDate}
            onSwipeStep={step}
            onTaskClick={onTaskClick}
            onToggleTaskDone={onToggleTaskDone}
            onDateClick={onDateClick}
            createPreview={createPreview}
            createdId={createdId}
            onUpdateTaskSchedule={onUpdateTaskSchedule}
            onRescheduleTask={onRescheduleTask}
          />
        </>
      )}

      {mode === "day" && (
        <CalendarSwipeSurface onSwipeStep={step} className="flex min-h-0 flex-1 flex-col" data-calendar-surface="day">
          <TimeGridView
            days={[selectedDate]}
            tasks={scheduledTasks}
            countdowns={countdowns}
            onTaskClick={onTaskClick}
            onToggleTaskDone={onToggleTaskDone}
            onUpdateTaskSchedule={onUpdateTaskSchedule}
            onDateClick={onDateClick}
            createPreview={createPreview}
            createdId={createdId}
            onOpenDay={openDayView}
            unscheduledDrag={unscheduledDrag}
            onUnscheduledDragTarget={onUnscheduledDragTarget}
            onTaskContextMenu={(task, event) => {
              event.preventDefault();
              event.stopPropagation();
              openTaskMenu(task, { x: event.clientX, y: event.clientY });
            }}
          />
        </CalendarSwipeSurface>
      )}

      {mode === "agenda" && (
        <DesktopAgendaView
          days={agendaDaysList}
          overdueTasks={agendaOverdueTasks}
          today={today}
          rangeStart={cursor}
          createdId={createdId}
          onTaskClick={onTaskClick}
          onToggleTaskDone={onToggleTaskDone}
          onDateClick={onDateClick}
          onUpdateTaskSchedule={onUpdateTaskSchedule}
          onRescheduleTask={onRescheduleTask}
          onLoadMore={() => setAgendaExtraPages((pages) => pages + 1)}
        />
      )}

      {mode === "year" && (
        <YearView
          year={cursor.getFullYear()}
          tasks={monthTasks}
          yearCountdowns={yearCountdowns}
          onOpenMonth={(month) => {
            const next = new Date(cursor.getFullYear(), month, 1);
            const selected = monthSelectionOnEntry(next, today, selectedRef.current);
            cursorRef.current = next;
            selectedRef.current = selected;
            modeRef.current = "month";
            setCursor(next);
            setSelectedDate(selected);
            setMode("month");
          }}
          onOpenDay={openDayView}
        />
      )}

      <CalendarTaskMenu
        request={taskMenu}
        onClose={() => setTaskMenu(null)}
        weekStart={weekStart}
        actions={taskMenuActions}
      />
    </div>
  );
}

function DayView({
  date,
  tasks,
  countdowns,
  onTaskClick,
  onToggleTaskDone,
  onUpdateTaskSchedule,
  onRescheduleTask,
  onAdd,
  createPreview,
  createdId,
}: {
  createPreview?: CalendarCreatePreview | null;
  createdId?: string | null;
  date: Date;
  tasks: TaskWithTags[];
  countdowns: CountdownDay[];
  onTaskClick?: (task: TaskWithTags) => void;
  onToggleTaskDone?: (task: TaskWithTags) => void;
  onUpdateTaskSchedule?: (taskId: string, schedule: TaskSchedule) => Promise<void>;
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
  onAdd?: () => void;
}) {
  const dayKey = keyFor(date);
  const dayCountdowns = useMemo(() => countdownsInRange(countdowns, date, date).get(dayKey) || [], [countdowns, date, dayKey]);
  const dayTasks = useMemo(
    () => tasks.filter((task) => {
      const start = getTaskDate(task);
      if (!start) return false;
      const end = task.schedule_end_at ? new Date(task.schedule_end_at) : start;
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      return start < dayEnd && end >= dayStart;
    }).sort((a, b) => (getTaskDate(a)?.getTime() || 0) - (getTaskDate(b)?.getTime() || 0)),
    [tasks, date]
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 md:px-8">
      {createPreview && calendarCreatePreviewOnDay(createPreview, date) && <p role="status" className="mb-3 truncate rounded-lg border border-dashed border-primary px-3 py-2 text-sm">{createPreview.title || "新事项"}</p>}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          添加任务或倒数日
        </button>
      )}
      {dayCountdowns.length > 0 && (
        <section className="mb-4">
          <div className="mb-2 text-sm font-semibold text-muted-foreground">倒数日</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dayCountdowns.map((item) => (
              <div key={item.id} data-calendar-created={item.id === createdId || undefined} className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3 ">
                <Hourglass className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                {item.repeat_annually && <span className="shrink-0 text-xs text-muted-foreground">每年</span>}
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="mb-2 text-sm font-semibold text-muted-foreground">任务（{dayTasks.length}）</div>
        {dayTasks.length === 0 ? (
          <div className="grid min-h-32 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">这一天没有排期任务</div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-background">
            {dayTasks.map((task) => {
              const start = getTaskDate(task);
              const schedule: TaskSchedule = {
                schedule_start_at: task.schedule_start_at || task.due_date,
                schedule_end_at: task.schedule_end_at || null,
                all_day: Boolean(task.all_day),
                timezone: task.timezone || null,
                recurrence_rule: task.recurrence_rule || null,
              };
              return (
                <div
                  key={task.id}
                  data-calendar-created={task.id === createdId || undefined}
                  data-calendar-task-id={task.id}
                  className={cn("flex min-h-14 select-none items-center gap-3 border-b px-4 py-2 last:border-b-0", isRecurringProjection(task) && "border-dashed text-muted-foreground")}
                >
                  <CalendarTaskCheckbox task={task} onToggle={onToggleTaskDone} className="h-5 w-5 text-xs" />
                  <button type="button" {...recurringPresentation(task)} onClick={() => onTaskClick?.(recurringSource(task))} className="min-w-0 flex-1 text-left">
                    <div className={cn("truncate text-sm font-medium", task.status === "done" && "text-muted-foreground line-through")}><TaskRepeatIcon task={task} />{task.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {task.all_day ? "全天" : start?.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </div>
                  </button>
                  {!isRecurringProjection(task) && (onUpdateTaskSchedule || onRescheduleTask) && (
                    <TaskDatePopover
                      value={schedule}
                      overdue={task.status !== "done" && task.status !== "cancelled" && isTaskOverdue(task)}
                      align="end"
                      className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto"
                      onChange={async (next) => {
                        if (onUpdateTaskSchedule) {
                          await onUpdateTaskSchedule(task.id, next);
                        } else if (next.schedule_start_at && onRescheduleTask) {
                          await onRescheduleTask(task.id, new Date(next.schedule_start_at));
                        }
                      }}
                      trigger={<button type="button" className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground">改期</button>}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function YearView({
  year,
  tasks,
  yearCountdowns,
  onOpenMonth,
  onOpenDay,
}: {
  year: number;
  tasks: TaskWithTags[];
  yearCountdowns: Map<string, CountdownDay[]>;
  onOpenMonth: (month: number) => void;
  onOpenDay: (date: Date) => void;
}) {
  const taskDays = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((task) => {
      const start = getTaskDate(task);
      if (!start) return;
      const end = task.schedule_end_at ? new Date(task.schedule_end_at) : start;
      for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() !== year) continue;
        set.add(keyFor(d));
      }
    });
    return set;
  }, [tasks, year]);
  const today = new Date();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MONTH_NAMES.map((name, month) => (
          <div key={name} className="rounded-xl border p-3">
            <button
              type="button"
              aria-label={`查看 ${month + 1} 月`}
              onClick={() => onOpenMonth(month)}
              className="mb-2 w-full rounded-md text-center text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {name}
            </button>
            <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
              {WEEKDAYS_SHORT.map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center">
              {getMonthCells(new Date(year, month, 1)).filter((cell) => cell.inMonth).length > 0 &&
                (() => {
                  const monthCells = getMonthCells(new Date(year, month, 1));
                  const leading = monthCells.findIndex((cell) => cell.inMonth);
                  const cellsInMonth = monthCells.filter((cell) => cell.inMonth);
                  return (
                    <>
                      {Array.from({ length: leading }).map((_, i) => <span key={`pad-${i}`} />)}
                      {cellsInMonth.map(({ date }) => {
                        const key = keyFor(date);
                        const hasTask = taskDays.has(key);
                        const hasCountdown = yearCountdowns.has(key);
                        const isToday = isSameDay(date, today);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => onOpenDay(date)}
                            title="查看这一天"
                            className={cn(
                              "relative mx-auto grid h-6 w-6 place-items-center rounded-full text-[11px] hover:bg-muted",
                              isToday && "bg-primary font-semibold text-primary-foreground hover:bg-primary"
                            )}
                          >
                            {date.getDate()}
                            {(hasTask || hasCountdown) && !isToday && (
                              <span className="absolute bottom-0 flex h-1 gap-px">
                                {hasTask && <span className="block h-1 w-1 rounded-full bg-primary" />}
                                {hasCountdown && <span className="block h-1 w-1 rounded-full bg-muted-foreground" />}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </>
                  );
                })()}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-primary" />任务</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />倒数日</span>
      </div>
    </div>
  );
}
