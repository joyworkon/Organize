"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CountdownChip } from "@/components/tasks/countdown-chip";
import { TaskDatePopover } from "@/components/tasks/task-date-popover";
import type { TaskSchedule } from "@/components/tasks/task-date-picker";
import {
  CalendarTaskCheckbox,
  TaskRepeatIcon,
  agendaEntryMeta,
  recurringPresentation,
  weekdayLabel,
} from "@/components/tasks/calendar-shared";
import {
  calendarDayDiff,
  getTaskDate,
  isSameCalendarDay,
  type AgendaDay,
} from "@/lib/tasks/calendar-agenda";
import { isRecurringProjection, recurringSource } from "@/lib/tasks/recurring-occurrences";
import { isTaskOverdue } from "@/lib/tasks/workspace";
import { cn } from "@/lib/utils";
import type { TaskWithTags } from "@organize/shared";

import { calendarCreateAnchor, type CalendarCreateAnchor } from "./calendar-quick-create";

/**
 * 桌面日程视图：从范围首日起按天分组列出任务与倒数日（跨天任务在每个覆盖日出现，
 * 文案口径与手机月议程一致，见 calendar-shared 的 agendaEntryMeta），
 * 顶部为可折叠的「已逾期」组（由 buildOverdueAgendaTasks 提供，不与范围内分组重复）。
 * 条目交互与其它视图一致：data-calendar-task-id 供根容器右键/长按/键盘菜单委托，
 * 点击打开 peek，行内勾选完成，「改期」复用 TaskDatePopover。
 */

interface DesktopAgendaViewProps {
  days: AgendaDay[];
  /** 已逾期且未在可见范围内出现的任务（未过滤时不为空才渲染该组）。 */
  overdueTasks: TaskWithTags[];
  today: Date;
  /** 范围首日；空态「新建任务」落在这一天。 */
  rangeStart: Date;
  createdId?: string | null;
  onTaskClick?: (task: TaskWithTags) => void;
  onToggleTaskDone?: (task: TaskWithTags) => void;
  onDateClick?: (date: Date, end?: Date, anchor?: CalendarCreateAnchor) => void;
  onUpdateTaskSchedule?: (taskId: string, schedule: TaskSchedule) => Promise<void>;
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
  /** 底部「加载更多」：再扩 30 天。 */
  onLoadMore?: () => void;
}

function dateLabel(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 逾期行的 meta：截止日期 + 时刻/全天（逾期组不按天分组，需要自带日期）。 */
function overdueMeta(task: TaskWithTags): string {
  const start = getTaskDate(task);
  if (!start) return "";
  const clock = task.all_day
    ? "全天"
    : start.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${dateLabel(start)} ${clock}`;
}

function AgendaTaskRow({
  task,
  meta,
  continued,
  createdId,
  onTaskClick,
  onToggleTaskDone,
  onUpdateTaskSchedule,
  onRescheduleTask,
}: {
  task: TaskWithTags;
  meta: string;
  continued?: boolean;
  createdId?: string | null;
  onTaskClick?: (task: TaskWithTags) => void;
  onToggleTaskDone?: (task: TaskWithTags) => void;
  onUpdateTaskSchedule?: (taskId: string, schedule: TaskSchedule) => Promise<void>;
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
}) {
  const projected = isRecurringProjection(task);
  const schedule: TaskSchedule = {
    schedule_start_at: task.schedule_start_at || task.due_date,
    schedule_end_at: task.schedule_end_at || null,
    all_day: Boolean(task.all_day),
    timezone: task.timezone || null,
    recurrence_rule: task.recurrence_rule || null,
  };
  return (
    <div
      data-calendar-created={task.id === createdId || undefined}
      data-calendar-task-id={task.id}
      data-agenda-span={continued ? "continued" : undefined}
      className={cn("flex min-h-14 select-none items-center gap-3 border-b px-3 py-2 last:border-b-0", projected && "border-dashed text-muted-foreground")}
    >
      <CalendarTaskCheckbox task={task} onToggle={onToggleTaskDone} className="h-5 w-5 text-xs" />
      <button type="button" {...recurringPresentation(task)} onClick={() => onTaskClick?.(recurringSource(task))} className="min-w-0 flex-1 text-left">
        <div className={cn("truncate text-sm font-medium", task.status === "done" && "text-muted-foreground line-through")}><TaskRepeatIcon task={task} />{task.title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div>
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
}

export function DesktopAgendaView({
  days,
  overdueTasks,
  today,
  rangeStart,
  createdId,
  onTaskClick,
  onToggleTaskDone,
  onDateClick,
  onUpdateTaskSchedule,
  onRescheduleTask,
  onLoadMore,
}: DesktopAgendaViewProps) {
  const [overdueOpen, setOverdueOpen] = useState(true);
  const empty = days.length === 0;

  return (
    <div data-calendar-surface="agenda" className="min-h-0 flex-1 overflow-y-auto">
      {overdueTasks.length > 0 && (
        <section data-agenda-overdue className="border-b px-4 py-3 md:px-6">
          <button
            type="button"
            aria-expanded={overdueOpen}
            onClick={() => setOverdueOpen((open) => !open)}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-muted/60 md:min-h-0 md:py-1"
          >
            {overdueOpen
              ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <strong className="text-base">已逾期</strong>
            <span className="rounded-full bg-muted px-1.5 text-xs font-medium leading-5 tabular-nums text-muted-foreground">{overdueTasks.length}</span>
          </button>
          {overdueOpen && (
            <div className="mt-2 overflow-hidden rounded-xl border bg-background">
              {overdueTasks.map((task) => (
                <AgendaTaskRow
                  key={task.id}
                  task={task}
                  meta={overdueMeta(task)}
                  createdId={createdId}
                  onTaskClick={onTaskClick}
                  onToggleTaskDone={onToggleTaskDone}
                  onUpdateTaskSchedule={onUpdateTaskSchedule}
                  onRescheduleTask={onRescheduleTask}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {empty ? (
        <div className="grid min-h-56 place-items-center px-6 py-8 text-center text-sm text-muted-foreground">
          <div className="space-y-3">
            <p>这一范围还没有已排期任务或倒数日</p>
            {onDateClick && (
              <Button type="button" variant="outline" size="sm" onClick={(event) => onDateClick(rangeStart, undefined, calendarCreateAnchor(event.currentTarget))}>
                <Plus className="h-4 w-4" />
                新建任务
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="divide-y">
          {days.map((day) => {
            const isToday = isSameCalendarDay(day.date, today);
            const isTomorrow = calendarDayDiff(day.date, today) === 1;
            return (
              <section key={day.key} data-agenda-day={day.key} data-agenda-today={isToday ? "true" : undefined} className="px-4 py-3 md:px-6">
                <button
                  type="button"
                  onClick={onDateClick ? (event) => onDateClick(day.date, undefined, calendarCreateAnchor(event.currentTarget)) : undefined}
                  aria-label={onDateClick ? `${dateLabel(day.date)} ${weekdayLabel(day.date)}${isToday ? "，今天" : ""}，添加` : undefined}
                  className={cn(
                    "mb-2 flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left md:min-h-0 md:py-1",
                    onDateClick && "hover:bg-muted/60",
                    isToday && "bg-accent/60"
                  )}
                >
                  <strong className="text-base">{dateLabel(day.date)}</strong>
                  <span className="text-xs text-muted-foreground">{weekdayLabel(day.date)}</span>
                  {isToday && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-4 text-primary-foreground">今天</span>}
                  {isTomorrow && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-4 text-muted-foreground">明天</span>}
                  {onDateClick && <Plus className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
                <div className="overflow-hidden rounded-xl border bg-background">
                  {day.countdowns.map((item) => (
                    <div key={item.id} data-calendar-created={item.id === createdId || undefined} className="flex min-h-12 items-center gap-2 border-b bg-muted/40 px-3 py-2 last:border-b-0">
                      <CountdownChip item={item} />
                    </div>
                  ))}
                  {day.entries.map((entry) => (
                    <AgendaTaskRow
                      key={`${entry.task.id}-${entry.spanIndex}`}
                      task={entry.task}
                      meta={agendaEntryMeta(entry)}
                      continued={entry.spanIndex > 0}
                      createdId={createdId}
                      onTaskClick={onTaskClick}
                      onToggleTaskDone={onToggleTaskDone}
                      onUpdateTaskSchedule={onUpdateTaskSchedule}
                      onRescheduleTask={onRescheduleTask}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {onLoadMore && (
        <div className="flex justify-center px-4 py-4">
          <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
            加载更多（30 天）
          </Button>
        </div>
      )}
    </div>
  );
}
