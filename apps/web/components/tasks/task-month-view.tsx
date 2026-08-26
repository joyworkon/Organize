"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Hourglass, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import { TaskDatePopover } from "@/components/tasks/task-date-popover";
import { annualOccurrenceDate } from "@/lib/tasks/countdown";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEKDAYS_SHORT = ["一", "二", "三", "四", "五", "六", "日"];
const MONTH_NAMES = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
/** 每周最多可见泳道数，超出的折叠为 +N */
export const MAX_LANES = 3;
const DAY_HEADER_PX = 28;
const LANE_HEIGHT_PX = 22;
/** 单元格底部为倒数日徽章预留的条带高度 */
const COUNTDOWN_STRIP_PX = 20;

export type CalendarMode = "day" | "month" | "year";

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

export interface AgendaGroup {
  date: Date;
  tasks: TaskWithTags[];
}

/** 移动端按当前月份生成有任务的日程分组，并按日期、时间、手工顺序稳定排序 */
export function getMonthAgenda(tasks: TaskWithTags[], cursor: Date): AgendaGroup[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const grouped = new Map<string, AgendaGroup>();
  tasks.forEach((task) => {
    const date = getTaskDate(task);
    if (!date || date.getFullYear() !== year || date.getMonth() !== month) return;
    const key = keyFor(date);
    const group = grouped.get(key) || { date: dateOnly(date), tasks: [] };
    group.tasks.push(task);
    grouped.set(key, group);
  });
  return Array.from(grouped.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((group) => ({
      ...group,
      tasks: [...group.tasks].sort((a, b) => {
        const time = (getTaskDate(a)?.getTime() || 0) - (getTaskDate(b)?.getTime() || 0);
        return time || a.sort_order - b.sort_order || a.id.localeCompare(b.id);
      }),
    }));
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
  countdowns?: CountdownDay[];
  onTaskClick?: (task: TaskWithTags) => void;
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
  onUpdateTaskSchedule?: (taskId: string, schedule: TaskSchedule) => Promise<void>;
  /** 点击日期空白处（月视图单元格 / 年视图小日历 / 日视图添加按钮） */
  onDateClick?: (date: Date) => void;
}

function CountdownChip({ item, compact = false }: { item: CountdownDay; compact?: boolean }) {
  return (
    <span
      title={`倒数日 · ${item.title}`}
      className={cn(
        "inline-flex min-w-0 items-center gap-0.5 truncate rounded bg-rose-100 px-1 text-[10px] leading-4 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
        compact && "leading-3"
      )}
    >
      <Hourglass className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{item.title}</span>
    </span>
  );
}

export function TaskMonthView({ tasks, countdowns = [], onTaskClick, onRescheduleTask, onUpdateTaskSchedule, onDateClick }: TaskMonthViewProps) {
  const today = new Date();
  const [mode, setMode] = useState<CalendarMode>("month");
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
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
  const agenda = useMemo(() => getMonthAgenda(monthTasks, cursor), [cursor, monthTasks]);

  const monthCountdowns = useMemo(() => {
    const first = cells[0]?.date ?? cursor;
    const last = cells[cells.length - 1]?.date ?? cursor;
    return countdownsInRange(countdowns, first, last);
  }, [cells, countdowns]);
  const yearCountdowns = useMemo(
    () => countdownsInRange(countdowns, new Date(cursor.getFullYear(), 0, 1), new Date(cursor.getFullYear(), 11, 31)),
    [countdowns, cursor]
  );

  const step = (direction: -1 | 1) => {
    if (mode === "day") {
      const next = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + direction);
      setSelectedDate(next);
      setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
    } else if (mode === "month") {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1));
    } else {
      setCursor(new Date(cursor.getFullYear() + direction, cursor.getMonth(), 1));
    }
  };
  const goToday = () => {
    setSelectedDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
  };
  const switchMode = (next: CalendarMode) => {
    setMode(next);
    if (next === "day") setSelectedDate(new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(selectedDate.getDate(), 28)));
  };

  const title =
    mode === "year" ? `${cursor.getFullYear()}年`
    : mode === "month" ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
    : `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日 ${WEEKDAYS[(selectedDate.getDay() + 6) % 7]}`;

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
        <h2 className="text-xl font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-1">
          <div className="mr-2 flex rounded-lg bg-muted p-1 text-sm">
            {(["day", "month", "year"] as CalendarMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => switchMode(item)}
                className={cn("rounded-md px-3 py-1.5", mode === item ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
              >
                {item === "day" ? "日" : item === "month" ? "月" : "年"}
              </button>
            ))}
          </div>
          <button type="button" aria-label="上一页" onClick={() => step(-1)} className="rounded-lg border p-2 hover:bg-muted"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" onClick={goToday} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">今天</button>
          <button type="button" aria-label="下一页" onClick={() => step(1)} className="rounded-lg border p-2 hover:bg-muted"><ChevronRight className="h-5 w-5" /></button>
        </div>
      </header>

      {mode === "month" && (
        <>
          <div className="hidden shrink-0 grid-cols-7 border-b bg-muted/20 md:grid">{WEEKDAYS.map((day) => <div key={day} className="border-r px-2 py-3 text-center text-sm text-muted-foreground last:border-r-0">{day}</div>)}</div>
          <div className="hidden min-h-0 flex-1 flex-col overflow-y-auto md:flex">
            {weeks.map((week, weekIndex) => {
              const { segments, hiddenByCol } = weekLayouts[weekIndex];
              return (
                <div
                  key={keyFor(week[0])}
                  className="relative grid flex-1 grid-cols-7"
                  style={{ minHeight: DAY_HEADER_PX + MAX_LANES * LANE_HEIGHT_PX + COUNTDOWN_STRIP_PX + 8 }}
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
                    const dayCountdowns = monthCountdowns.get(cellKey) || [];
                    return (
                      <div
                        key={cellKey}
                        onClick={onDateClick ? () => onDateClick(date) : undefined}
                        className={cn("relative border-b border-r p-1.5 last:border-r-0", onDateClick && "cursor-pointer hover:bg-muted/40", !inMonth && "bg-muted/10 text-muted-foreground/50", isSameDay(date, today) && "bg-blue-50/70 dark:bg-blue-950/20", dragOverDate === cellKey && "bg-primary/10 ring-2 ring-inset ring-primary")}
                      >
                        <div className={cn("flex h-7 w-7 items-center justify-center rounded-full text-sm", isSameDay(date, today) && "bg-blue-500 font-semibold text-white")}>{date.getDate()}</div>
                        <div className="absolute inset-x-1.5 bottom-1 flex items-center gap-1 overflow-hidden">
                          {dayCountdowns[0] && <CountdownChip item={dayCountdowns[0]} />}
                          {dayCountdowns.length > 1 && <span className="shrink-0 text-[10px] text-rose-500">+{dayCountdowns.length - 1}</span>}
                          {hiddenByCol[col] > 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">+{hiddenByCol[col]}</span>}
                        </div>
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
          <div className="min-h-0 flex-1 overflow-y-auto md:hidden">
            {agenda.length === 0 && monthCountdowns.size === 0 ? (
              <div className="grid min-h-56 place-items-center px-6 text-center text-sm text-muted-foreground">
                本月还没有已排期任务或倒数日
              </div>
            ) : (
              <div className="divide-y">
                {agenda.map((group) => (
                  <section key={keyFor(group.date)} className="px-4 py-4">
                    <div className="mb-2 flex items-baseline gap-2">
                      <strong className="text-base">{group.date.getMonth() + 1}月{group.date.getDate()}日</strong>
                      <span className="text-xs text-muted-foreground">{WEEKDAYS[(group.date.getDay() + 6) % 7]}</span>
                    </div>
                    <div className="overflow-hidden rounded-xl border bg-background">
                      {(monthCountdowns.get(keyFor(group.date)) || []).map((item) => (
                        <div key={item.id} className="flex min-h-12 items-center gap-2 border-b bg-rose-50/50 px-3 py-2 dark:bg-rose-950/20">
                          <CountdownChip item={item} />
                        </div>
                      ))}
                      {group.tasks.map((task) => {
                        const date = getTaskDate(task);
                        const schedule: TaskSchedule = {
                          schedule_start_at: task.schedule_start_at || task.due_date,
                          schedule_end_at: task.schedule_end_at || null,
                          all_day: Boolean(task.all_day),
                          timezone: task.timezone || null,
                          recurrence_rule: task.recurrence_rule || null,
                        };
                        return (
                          <div key={task.id} className="flex min-h-14 items-center gap-3 border-b px-3 py-2 last:border-b-0">
                            <button type="button" onClick={() => onTaskClick?.(task)} className="min-w-0 flex-1 text-left">
                              <div className={cn("truncate text-sm font-medium", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {task.all_day ? "全天" : date?.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                              </div>
                            </button>
                            {(onUpdateTaskSchedule || onRescheduleTask) && (
                              <TaskDatePopover
                                value={schedule}
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
                  </section>
                ))}
                {/* 没有任务但有倒数日的日期也要在移动端展示 */}
                {Array.from(monthCountdowns.entries())
                  .filter(([key]) => !agenda.some((group) => keyFor(group.date) === key))
                  .map(([key, items]) => {
                    const [y, m, d] = key.split("-").map(Number);
                    const date = new Date(y, m, d);
                    if (date.getMonth() !== cursor.getMonth()) return null;
                    return (
                      <section key={key} className="px-4 py-4">
                        <div className="mb-2 flex items-baseline gap-2">
                          <strong className="text-base">{date.getMonth() + 1}月{date.getDate()}日</strong>
                          <span className="text-xs text-muted-foreground">{WEEKDAYS[(date.getDay() + 6) % 7]}</span>
                        </div>
                        <div className="overflow-hidden rounded-xl border bg-background">
                          {items.map((item) => (
                            <div key={item.id} className="flex min-h-12 items-center gap-2 bg-rose-50/50 px-3 py-2 dark:bg-rose-950/20">
                              <CountdownChip item={item} />
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
              </div>
            )}
          </div>
        </>
      )}

      {mode === "day" && (
        <DayView
          date={selectedDate}
          tasks={monthTasks}
          countdowns={countdowns}
          onTaskClick={onTaskClick}
          onUpdateTaskSchedule={onUpdateTaskSchedule}
          onRescheduleTask={onRescheduleTask}
          onAdd={onDateClick ? () => onDateClick(selectedDate) : undefined}
        />
      )}

      {mode === "year" && (
        <YearView
          year={cursor.getFullYear()}
          tasks={monthTasks}
          yearCountdowns={yearCountdowns}
          onDateClick={onDateClick}
        />
      )}
    </div>
  );
}

function DayView({
  date,
  tasks,
  countdowns,
  onTaskClick,
  onUpdateTaskSchedule,
  onRescheduleTask,
  onAdd,
}: {
  date: Date;
  tasks: TaskWithTags[];
  countdowns: CountdownDay[];
  onTaskClick?: (task: TaskWithTags) => void;
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
              <div key={item.id} className="flex items-center gap-2 rounded-xl border bg-rose-50/60 p-3 dark:bg-rose-950/20">
                <Hourglass className="h-4 w-4 shrink-0 text-rose-500" />
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
                <div key={task.id} className="flex min-h-14 items-center gap-3 border-b px-4 py-2 last:border-b-0">
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs", task.status === "done" ? "bg-muted" : "border-muted-foreground/30")}>{task.status === "done" ? "✓" : ""}</span>
                  <button type="button" onClick={() => onTaskClick?.(task)} className="min-w-0 flex-1 text-left">
                    <div className={cn("truncate text-sm font-medium", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {task.all_day ? "全天" : start?.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                    </div>
                  </button>
                  {(onUpdateTaskSchedule || onRescheduleTask) && (
                    <TaskDatePopover
                      value={schedule}
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
  onDateClick,
}: {
  year: number;
  tasks: TaskWithTags[];
  yearCountdowns: Map<string, CountdownDay[]>;
  onDateClick?: (date: Date) => void;
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
            <div className="mb-2 text-center text-sm font-medium">{name}</div>
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
                            onClick={onDateClick ? () => onDateClick(date) : undefined}
                            title={onDateClick ? "点击添加任务或倒数日" : undefined}
                            className={cn(
                              "relative mx-auto grid h-6 w-6 place-items-center rounded-full text-[11px] hover:bg-muted",
                              isToday && "bg-blue-500 font-semibold text-white hover:bg-blue-500"
                            )}
                          >
                            {date.getDate()}
                            {(hasTask || hasCountdown) && !isToday && (
                              <span className="absolute bottom-0 flex h-1 gap-px">
                                {hasTask && <span className="block h-1 w-1 rounded-full bg-blue-500" />}
                                {hasCountdown && <span className="block h-1 w-1 rounded-full bg-rose-500" />}
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
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" />任务</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />倒数日</span>
      </div>
    </div>
  );
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
