"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskWithTags } from "@organize/shared";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

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
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-y-auto">
        {cells.map((cell) => {
          const cellDate = dateOnly(cell.date);
          const cellKey = keyFor(cell.date);
          const dayTasks = monthTasks.filter((task) => {
            const start = dateOnly(getTaskDate(task)!);
            const end = dateOnly(taskEnd(task)!);
            return cellDate >= start && cellDate <= end;
          });
          return (
            <div
              key={cellKey}
              onDragOver={onRescheduleTask ? (event) => { event.preventDefault(); setDragOverDate(cellKey); } : undefined}
              onDragLeave={() => setDragOverDate(null)}
              onDrop={onRescheduleTask ? async (event) => { event.preventDefault(); const task = monthTasks.find((item) => item.id === dragTaskId); if (!task) return; const start = getTaskDate(task); if (!start) return; const next = new Date(cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate(), start.getHours(), start.getMinutes()); setDragOverDate(null); setDragTaskId(null); await onRescheduleTask(task.id, next); } : undefined}
              className={cn("min-h-[108px] border-b border-r p-1.5 transition-colors last:border-r-0 lg:min-h-0", !cell.inMonth && "bg-muted/10 text-muted-foreground/50", isSameDay(cell.date, today) && "bg-blue-50/70 dark:bg-blue-950/20", dragOverDate === cellKey && "bg-primary/10 ring-2 ring-inset ring-primary")}
            >
              <div className={cn("mb-1 flex h-7 w-7 items-center justify-center rounded-full text-sm", isSameDay(cell.date, today) && "bg-blue-500 font-semibold text-white")}>{cell.date.getDate()}</div>
              <div className="space-y-1">
                {dayTasks.slice(0, 3).map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    draggable={Boolean(onRescheduleTask)}
                    onDragStart={(event) => { setDragTaskId(task.id); event.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => setDragTaskId(null)}
                    onClick={(event) => { event.stopPropagation(); onTaskClick?.(task); }}
                    className={cn("flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs transition-colors hover:brightness-95", task.status === "done" ? "bg-muted text-muted-foreground" : task.category === "work" ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100" : task.category === "study" ? "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100" : task.category === "life" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100", dragTaskId === task.id && "opacity-40")}
                  >
                    <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded border border-current/40">{task.status === "done" && "✓"}</span>
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    {timeLabel(task) && <span className="shrink-0 text-[10px] opacity-70">{timeLabel(task)}</span>}
                  </button>
                ))}
                {dayTasks.length > 3 && <span className="px-1.5 text-xs text-muted-foreground">+{dayTasks.length - 3} 更多</span>}
              </div>
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
