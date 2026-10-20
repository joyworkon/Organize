"use client";

import { useEffect, useMemo, useRef } from "react";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CountdownChip } from "@/components/tasks/countdown-chip";
import { TaskDatePopover } from "@/components/tasks/task-date-popover";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";
import { CalendarSwipeSurface } from "@/components/tasks/calendar-swipe-surface";
import { TaskRepeatIcon, WEEKDAYS_SHORT, recurringPresentation, weekdayLabel } from "@/components/tasks/calendar-shared";
import {
  agendaScrollTargetKey,
  buildMonthAgenda,
  calendarDayKey,
  calendarDayMarkers,
  compactMonthRows,
  emptyMonthAddDate,
  getMonthCells,
  getTaskDate,
  isSameCalendarDay,
  isSameCalendarMonth,
  withSelectedAgendaDay,
  type AgendaDay,
  type AgendaEntry,
} from "@/lib/tasks/calendar-agenda";
import { isRecurringProjection, recurringSource } from "@/lib/tasks/recurring-occurrences";
import { isTaskOverdue } from "@/lib/tasks/workspace";
import { cn } from "@/lib/utils";
import type { CountdownDay, TaskWithTags } from "@organize/shared";

interface MobileMonthViewProps {
  cursor: Date;
  today: Date;
  selectedDate: Date;
  /** 已包含重复任务只读投影的可见任务 */
  tasks: TaskWithTags[];
  /** 42 格范围内的倒数日，按 calendarDayKey 分组 */
  countdownsByDay: Map<string, CountdownDay[]>;
  /** 外层在「今天」或再次点同一天时递增，用于重新滚动议程 */
  focusNonce: number;
  onSelectDate: (date: Date) => void;
  onSwipeStep: (direction: -1 | 1) => void;
  onTaskClick?: (task: TaskWithTags) => void;
  onDateClick?: (date: Date) => void;
  onUpdateTaskSchedule?: (taskId: string, schedule: TaskSchedule) => Promise<void>;
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
}

function dateLabel(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 议程列表内滚到某个分组：只滚列表容器自己，不让外层页面跟着跳。 */
function scrollAgendaTo(list: HTMLElement, section: HTMLElement | null) {
  if (!section) {
    list.scrollTop = 0;
    return;
  }
  const delta = section.getBoundingClientRect().top - list.getBoundingClientRect().top;
  list.scrollTop = Math.max(0, list.scrollTop + delta);
}

function entryMeta(entry: AgendaEntry): string {
  const { task, spanIndex, spanDays } = entry;
  if (spanIndex > 0) return `跨天 · 第 ${spanIndex + 1}/${spanDays} 天`;
  const start = getTaskDate(task);
  const clock = task.all_day
    ? "全天"
    : start?.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) ?? "";
  return spanDays > 1 ? `${clock} · 共 ${spanDays} 天` : clock;
}

/**
 * 手机（<md）月视图：紧凑迷你月历 + 当月议程。
 * 迷你月历故意不用 grid/gridcell 角色、不渲染倒数日芯片、按钮不带 absolute——
 * 桌面月网格的测试与 e2e 按这些选择器取元素。
 */
export function MobileMonthView({
  cursor,
  today,
  selectedDate,
  tasks,
  countdownsByDay,
  focusNonce,
  onSelectDate,
  onSwipeStep,
  onTaskClick,
  onDateClick,
  onUpdateTaskSchedule,
  onRescheduleTask,
}: MobileMonthViewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => getMonthCells(cursor), [cursor]);
  const rows = useMemo(() => compactMonthRows(cells), [cells]);
  const markers = useMemo(
    () => calendarDayMarkers(tasks, countdownsByDay, cells.map((cell) => cell.date)),
    [tasks, countdownsByDay, cells]
  );
  const agenda = useMemo(() => buildMonthAgenda(tasks, countdownsByDay, cursor), [tasks, countdownsByDay, cursor]);
  const days = useMemo(() => withSelectedAgendaDay(agenda, selectedDate, cursor), [agenda, selectedDate, cursor]);
  const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
  const selectedKey = calendarDayKey(selectedDate);
  const selectedInMonth = isSameCalendarMonth(selectedDate, cursor);

  // 滚动目标：选中日在本月 → 选中日；当前月 → 今天或之后最近有安排的一天；否则回顶部。
  // 触发条件限定在 月份 / 选中日 / 外部 focus 请求 / 首批数据到达（空 → 非空）：
  // 任务增删改不该把列表拽走，所以从 ref 读最新议程。
  const latestRef = useRef({ agenda, today, cursor });
  latestRef.current = { agenda, today, cursor };
  const agendaReady = agenda.length > 0;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const latest = latestRef.current;
    const targetKey = selectedInMonth ? selectedKey : agendaScrollTargetKey(latest.agenda, latest.today, latest.cursor);
    const section = targetKey ? list.querySelector<HTMLElement>(`[data-agenda-day="${targetKey}"]`) : null;
    scrollAgendaTo(list, section);
  }, [monthKey, selectedKey, selectedInMonth, focusNonce, agendaReady]);

  return (
    <div data-calendar-surface="mobile-month" className="flex min-h-0 flex-1 flex-col md:hidden">
      <CalendarSwipeSurface onSwipeStep={onSwipeStep} className="shrink-0 border-b px-2 pb-2 pt-1">
        <div role="group" aria-label={`${cursor.getFullYear()}年${cursor.getMonth() + 1}月月历`} data-calendar-surface="mini-month">
          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
            {WEEKDAYS_SHORT.map((day) => <span key={day} className="py-1">{day}</span>)}
          </div>
          {rows.map((row) => (
            <div key={calendarDayKey(row[0].date)} className="grid grid-cols-7">
              {row.map(({ date, inMonth }) => {
                const key = calendarDayKey(date);
                const marker = inMonth ? markers.get(key) : undefined;
                const isToday = isSameCalendarDay(date, today);
                const selected = isSameCalendarDay(date, selectedDate);
                const summary = [
                  marker && marker.tasks > 0 ? `${marker.tasks} 个任务` : "",
                  marker && marker.countdowns > 0 ? `${marker.countdowns} 个倒数日` : "",
                ].filter(Boolean).join("，");
                return (
                  <button
                    key={key}
                    type="button"
                    data-mini-month-day={key}
                    aria-pressed={selected}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`${dateLabel(date)} ${weekdayLabel(date)}${isToday ? "，今天" : ""}${summary ? `，${summary}` : ""}`}
                    onClick={() => onSelectDate(date)}
                    className={cn(
                      "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md text-sm tabular-nums",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      inMonth ? "text-foreground" : "text-muted-foreground",
                      !selected && "hover:bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 place-items-center rounded-full",
                        selected && "bg-primary font-semibold text-primary-foreground",
                        isToday && "font-semibold",
                        isToday && !selected && "ring-1 ring-inset ring-primary"
                      )}
                    >
                      {date.getDate()}
                    </span>
                    <span className="flex h-1 items-center gap-0.5" aria-hidden="true">
                      {marker && marker.tasks > 0 && <span data-marker="task" className="h-1 w-1 rounded-full bg-primary" />}
                      {marker && marker.countdowns > 0 && <span data-marker="countdown" className="h-1 w-1 rounded-full bg-muted-foreground" />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </CalendarSwipeSurface>

      <div ref={listRef} data-calendar-agenda="" className="relative min-h-0 flex-1 overflow-y-auto">
        {days.length === 0 ? (
          <div className="grid min-h-56 place-items-center px-6 py-8 text-center text-sm text-muted-foreground">
            <div className="space-y-3">
              <p>本月还没有已排期任务或倒数日</p>
              {onDateClick && (
                <Button type="button" variant="outline" size="sm" onClick={() => onDateClick(emptyMonthAddDate(cursor, today, selectedDate))}>
                  <Plus className="h-4 w-4" />
                  添加任务
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {/* 整月为空但选中了某天：仍列出该天的空态行，并在顶部提示整月为空 */}
            {agenda.length === 0 && (
              <p className="px-5 pt-3 text-xs text-muted-foreground">本月还没有已排期任务或倒数日</p>
            )}
            {days.map((day) => (
              <AgendaDaySection
                key={day.key}
                day={day}
                isToday={isSameCalendarDay(day.date, today)}
                onTaskClick={onTaskClick}
                onDateClick={onDateClick}
                onUpdateTaskSchedule={onUpdateTaskSchedule}
                onRescheduleTask={onRescheduleTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgendaDaySection({
  day,
  isToday,
  onTaskClick,
  onDateClick,
  onUpdateTaskSchedule,
  onRescheduleTask,
}: {
  day: AgendaDay;
  isToday: boolean;
  onTaskClick?: (task: TaskWithTags) => void;
  onDateClick?: (date: Date) => void;
  onUpdateTaskSchedule?: (taskId: string, schedule: TaskSchedule) => Promise<void>;
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
}) {
  const empty = day.entries.length === 0 && day.countdowns.length === 0;
  return (
    <section data-agenda-day={day.key} data-agenda-today={isToday ? "true" : undefined} className="px-4 py-3">
      <button
        type="button"
        onClick={onDateClick ? () => onDateClick(day.date) : undefined}
        aria-label={onDateClick ? `${dateLabel(day.date)} ${weekdayLabel(day.date)}${isToday ? "，今天" : ""}，添加` : undefined}
        className={cn("mb-2 flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left", onDateClick && "hover:bg-muted/60")}
      >
        <strong className="text-base">{dateLabel(day.date)}</strong>
        <span className="text-xs text-muted-foreground">{weekdayLabel(day.date)}</span>
        {isToday && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-4 text-primary-foreground">今天</span>}
        {onDateClick && <Plus className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {empty ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground">
          <span>这一天没有安排</span>
          {onDateClick && (
            <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => onDateClick(day.date)}>
              <Plus className="h-4 w-4" />
              添加任务
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-background">
          {day.countdowns.map((item) => (
            <div key={item.id} className="flex min-h-12 items-center gap-2 border-b bg-muted/40 px-3 py-2 last:border-b-0">
              <CountdownChip item={item} />
            </div>
          ))}
          {day.entries.map((entry) => {
            const { task } = entry;
            const schedule: TaskSchedule = {
              schedule_start_at: task.schedule_start_at || task.due_date,
              schedule_end_at: task.schedule_end_at || null,
              all_day: Boolean(task.all_day),
              timezone: task.timezone || null,
              recurrence_rule: task.recurrence_rule || null,
            };
            const projected = isRecurringProjection(task);
            return (
              <div
                key={task.id}
                data-agenda-span={entry.spanIndex > 0 ? "continued" : undefined}
                className={cn("flex min-h-14 items-center gap-3 border-b px-3 py-2 last:border-b-0", projected && "border-dashed text-muted-foreground")}
              >
                <button type="button" {...recurringPresentation(task)} onClick={() => onTaskClick?.(recurringSource(task))} className="min-w-0 flex-1 text-left">
                  <div className={cn("truncate text-sm font-medium", task.status === "done" && "text-muted-foreground line-through")}><TaskRepeatIcon task={task} />{task.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{entryMeta(entry)}</div>
                </button>
                {!projected && (onUpdateTaskSchedule || onRescheduleTask) && (
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
  );
}
