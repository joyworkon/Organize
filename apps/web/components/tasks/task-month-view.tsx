"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskWithTags } from "@organize/shared";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** 每周最多可见泳道数，超出的折叠为 +N */
export const MAX_LANES = 3;
const DAY_HEADER_PX = 28;
const LANE_HEIGHT_PX = 22;

export function getTaskDate(task: { schedule_start_at?: string | null; due_date?: string | null }) {
  const value = task.schedule_start_at || task.due_date;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getMonthCells(cursor: Date): { date: Date; inMonth: boolean }[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = offset; i > 0; i -= 1) cells.push({ date: new Date(year, month, 1 - i), inMonth: false });
  const days = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= days; day += 1) cells.push({ date: new Date(year, month, day), inMonth: true });
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }
  return cells;
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

function keyFor(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateOnly(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function taskEnd(task: TaskWithTags) {
  const start = getTaskDate(task);
  const end = task.schedule_end_at ? new Date(task.schedule_end_at) : start;
  return end && !Number.isNaN(end.getTime()) ? end : start;
}

function timeLabel(task: TaskWithTags) {
  const date = getTaskDate(task);
  if (!date || task.all_day) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 天差（对 DST 23/25 小时的天做四舍五入） */
function dayDiff(a: Date, b: Date) {
  return Math.round((dateOnly(a).getTime() - dateOnly(b).getTime()) / 86400000);
}

export interface WeekSegment {
  task: TaskWithTags;
  /** 起始列 0-6 */
  startCol: number;
  /** 结束列 0-6（含） */
  endCol: number;
  /** 从上周延续（左端不闭合、不显示勾选框） */
  continuesBefore: boolean;
  /** 延续到下周（右端不闭合） */
  continuesAfter: boolean;
  /** 泳道序号 */
  lane: number;
}

/**
 * 把任务按"周"切成连续条形段并贪心分配泳道。
 * 返回可见段（泳道 < MAX_LANES）与每列被折叠的任务数（+N 更多）。
 */
export function layoutWeekSegments(
  tasks: TaskWithTags[],
  week: Date[]
): { segments: WeekSegment[]; hiddenByCol: number[] } {
  const weekStart = dateOnly(week[0]);
  const weekEnd = dateOnly(week[6]);

  const segs: WeekSegment[] = [];
  for (const task of tasks) {
    const start = getTaskDate(task);
    if (!start) continue;
    const end = taskEnd(task) || start;
    const taskStart = dateOnly(start);
    const taskFinish = dateOnly(end);
    if (taskFinish < weekStart || taskStart > weekEnd) continue;
    segs.push({
      task,
      startCol: Math.max(0, dayDiff(taskStart, weekStart)),
      endCol: Math.min(6, dayDiff(taskFinish, weekStart)),
      continuesBefore: taskStart < weekStart,
      continuesAfter: taskFinish > weekEnd,
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

  const hiddenByCol = [0, 0, 0, 0, 0, 0, 0];
  const visible: WeekSegment[] = [];
  for (const seg of segs) {
    if (seg.lane < MAX_LANES) {
      visible.push(seg);
    } else {
      for (let col = seg.startCol; col <= seg.endCol; col += 1) hiddenByCol[col] += 1;
    }
  }
  return { segments: visible, hiddenByCol };
}

function categoryClass(task: TaskWithTags) {
  if (task.status === "done") return "bg-muted text-muted-foreground";
  switch (task.category) {
    case "work": return "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100";
    case "study": return "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100";
    case "life": return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100";
    default: return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
  }
}

interface TaskMonthViewProps {
  tasks: TaskWithTags[];
  onTaskClick?: (task: TaskWithTags) => void;
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
}

export function TaskMonthView({ tasks, onTaskClick, onRescheduleTask }: TaskMonthViewProps) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const cells = useMemo(() => getMonthCells(cursor), [cursor]);
  const monthTasks = useMemo(() => tasks.filter((task) => getTaskDate(task)), [tasks]);
  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < 6; i += 1) result.push(cells.slice(i * 7, i * 7 + 7).map((c) => c.date));
    return result;
  }, [cells]);
  const weekLayouts = useMemo(
    () => weeks.map((week) => layoutWeekSegments(monthTasks, week)),
    [weeks, monthTasks]
  );

  /** 从拖拽事件的横坐标算出目标列（0-6），用于行级 drop */
  const colFromEvent = (event: React.DragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    return Math.min(6, Math.max(0, Math.floor(ratio * 7)));
  };

  return (
    <div className="organize-task-month-view flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3 md:px-8">
        <CalendarDays className="h-6 w-6" />
        <h2 className="text-xl font-semibold">{cursor.getFullYear()}年{cursor.getMonth() + 1}月</h2>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm hover:bg-muted">月<ChevronRight className="h-3.5 w-3.5 rotate-90" /></button>
          <button type="button" aria-label="上个月" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-lg border p-2 hover:bg-muted"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">今天</button>
          <button type="button" aria-label="下个月" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-lg border p-2 hover:bg-muted"><ChevronRight className="h-5 w-5" /></button>
          <button type="button" aria-label="更多日历操作" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><MoreHorizontal className="h-5 w-5" /></button>
        </div>
      </header>

      <div className="grid shrink-0 grid-cols-7 border-b bg-muted/20">{WEEKDAYS.map((day) => <div key={day} className="border-r px-2 py-3 text-center text-sm text-muted-foreground last:border-r-0">{day}</div>)}</div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {weeks.map((week, weekIndex) => {
          const { segments, hiddenByCol } = weekLayouts[weekIndex];
          return (
            <div
              key={keyFor(week[0])}
              className="relative grid flex-1 grid-cols-7"
              style={{ minHeight: DAY_HEADER_PX + MAX_LANES * LANE_HEIGHT_PX + 24 }}
              onDragOver={onRescheduleTask ? (event) => { event.preventDefault(); setDragOverDate(keyFor(week[colFromEvent(event)])); } : undefined}
              onDragLeave={() => setDragOverDate(null)}
              onDrop={onRescheduleTask ? async (event) => {
                event.preventDefault();
                const col = colFromEvent(event);
                const task = monthTasks.find((item) => item.id === dragTaskId);
                setDragOverDate(null);
                setDragTaskId(null);
                if (!task) return;
                const start = getTaskDate(task);
                if (!start) return;
                const target = week[col];
                const next = new Date(target.getFullYear(), target.getMonth(), target.getDate(), start.getHours(), start.getMinutes());
                await onRescheduleTask(task.id, next);
              } : undefined}
            >
              {week.map((date, col) => {
                const inMonth = cells[weekIndex * 7 + col].inMonth;
                const cellKey = keyFor(date);
                return (
                  <div
                    key={cellKey}
                    className={cn("relative border-b border-r p-1.5 last:border-r-0", !inMonth && "bg-muted/10 text-muted-foreground/50", isSameDay(date, today) && "bg-blue-50/70 dark:bg-blue-950/20", dragOverDate === cellKey && "bg-primary/10 ring-2 ring-inset ring-primary")}
                  >
                    <div className={cn("flex h-7 w-7 items-center justify-center rounded-full text-sm", isSameDay(date, today) && "bg-blue-500 font-semibold text-white")}>{date.getDate()}</div>
                    {hiddenByCol[col] > 0 && (
                      <div className="absolute bottom-1 left-1.5 text-xs text-muted-foreground">
                        +{hiddenByCol[col]} 更多
                      </div>
                    )}
                  </div>
                );
              })}
              {/* 跨天任务连续条（绝对定位叠加在周行上） */}
              {segments.map((seg) => (
                <button
                  type="button"
                  key={`${seg.task.id}-${weekIndex}`}
                  draggable={Boolean(onRescheduleTask)}
                  onDragStart={(event) => { setDragTaskId(seg.task.id); event.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragTaskId(null)}
                  onClick={(event) => { event.stopPropagation(); onTaskClick?.(seg.task); }}
                  className={cn(
                    "absolute z-10 flex items-center gap-1 px-1.5 text-left text-xs transition-colors hover:brightness-95",
                    categoryClass(seg.task),
                    !seg.continuesBefore && "rounded-l",
                    !seg.continuesAfter && "rounded-r",
                    dragTaskId === seg.task.id && "opacity-40"
                  )}
                  style={{
                    top: DAY_HEADER_PX + seg.lane * LANE_HEIGHT_PX + 2,
                    height: LANE_HEIGHT_PX - 4,
                    left: `calc(${(seg.startCol / 7) * 100}% + ${seg.continuesBefore ? 0 : 2}px)`,
                    width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - ${(seg.continuesBefore ? 0 : 2) + (seg.continuesAfter ? 0 : 2)}px)`,
                  }}
                >
                  {!seg.continuesBefore && (
                    <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded border border-current/40">{seg.task.status === "done" && "✓"}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{seg.task.title}</span>
                  {!seg.continuesAfter && timeLabel(seg.task) && <span className="shrink-0 text-[10px] opacity-70">{timeLabel(seg.task)}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
