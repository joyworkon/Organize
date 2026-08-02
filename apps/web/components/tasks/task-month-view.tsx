"use client";
/**
 * 任务月历视图（任务3）：周一开头月格、月切换、跨月灰日、按清单色、多日横条。
 * 拖拽改期、+N 溢出在后续迭代加（本版先做基础月格 + 点击任务）。
 */
import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { TaskWithTags } from "@organize/shared";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 导出纯函数供单测（不依赖 React/DOM） */
export function getTaskDate(t: { schedule_start_at?: string | null; due_date?: string | null }): Date | null {
  const d = t.schedule_start_at || t.due_date;
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

/** 计算月格 42 格（周一开头） */
export function getMonthCells(cursor: Date): { date: Date; inMonth: boolean }[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = offset - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month, -i), inMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ date: new Date(year, month, i), inMonth: true });
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }
  return cells;
}

/** 按日期分组任务 */
export function groupTasksByDate(tasks: TaskWithTags[]): Map<string, TaskWithTags[]> {
  const m = new Map<string, TaskWithTags[]>();
  for (const t of tasks) {
    const d = getTaskDate(t);
    if (!d) continue;
    const key = d.toDateString();
    const arr = m.get(key) || [];
    arr.push(t);
    m.set(key, arr);
  }
  return m;
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

interface TaskMonthViewProps {
  tasks: TaskWithTags[];
  onTaskClick?: (task: TaskWithTags) => void;
  onDateClick?: (date: Date) => void;
  /** 拖拽改期：把任务移到新日期（保留时长/本地墙钟时间），失败由调用方回滚 */
  onRescheduleTask?: (taskId: string, newStartDate: Date) => Promise<void>;
}

export function TaskMonthView({ tasks, onTaskClick, onDateClick, onRescheduleTask }: TaskMonthViewProps) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const monthDays = useMemo(() => getMonthCells(cursor), [cursor]);
  const tasksByDate = useMemo(() => groupTasksByDate(tasks), [tasks]);

  const today = new Date();
  const monthLabel = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;

  return (
    <div className="organize-task-month">
      {/* 月历头 */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lg">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>
            今天
          </Button>
          <button className="p-1.5 rounded hover:bg-muted" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="p-1.5 rounded hover:bg-muted" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 星期头 */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
        ))}
      </div>

      {/* 月格 */}
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {monthDays.map((cell, i) => {
          const dayTasks = tasksByDate.get(cell.date.toDateString()) || [];
          const isToday = sameDay(cell.date, today);
          const cellKey = cell.date.toDateString();
          return (
            <div
              key={i}
              className={cn(
                "min-h-[80px] sm:min-h-[100px] p-1 bg-background flex flex-col gap-0.5",
                !cell.inMonth && "opacity-40",
                onDateClick && "cursor-pointer hover:bg-muted/50",
                dragOverDate === cellKey && "ring-2 ring-primary ring-inset"
              )}
              onClick={() => onDateClick?.(cell.date)}
              onDragOver={onRescheduleTask ? (e) => { e.preventDefault(); setDragOverDate(cellKey); } : undefined}
              onDragLeave={() => setDragOverDate(null)}
              onDrop={onRescheduleTask ? async (e) => {
                e.preventDefault();
                setDragOverDate(null);
                if (!dragTaskId) return;
                const task = tasks.find((t) => t.id === dragTaskId);
                if (!task) return;
                const oldStart = getTaskDate(task);
                if (!oldStart) return;
                // 保留时长（如有 end）
                const oldEnd = task.schedule_end_at ? new Date(task.schedule_end_at) : null;
                const duration = oldEnd ? oldEnd.getTime() - oldStart.getTime() : 0;
                // 新开始：目标日期 + 原来的时/分（保留本地墙钟时间）
                const newStart = new Date(cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate(), oldStart.getHours(), oldStart.getMinutes());
                await onRescheduleTask(dragTaskId, newStart);
                setDragTaskId(null);
              } : undefined}
            >
              <span className={cn(
                "text-xs w-6 h-6 flex items-center justify-center rounded-full",
                isToday && "bg-primary text-primary-foreground font-medium"
              )}>
                {cell.date.getDate()}
              </span>
              {dayTasks.slice(0, 3).map((t) => (
                <button
                  key={t.id}
                  onClick={(e) => { e.stopPropagation(); onTaskClick?.(t); }}
                  draggable={!!onRescheduleTask}
                  onDragStart={(e) => { setDragTaskId(t.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragTaskId(null)}
                  className={cn(
                    "text-left text-xs px-1.5 py-0.5 rounded truncate border-l-2 hover:bg-muted",
                    dragTaskId === t.id && "opacity-40"
                  )}
                  style={{ borderLeftColor: (t as any).list_color || "#3b82f6" }}
                  title={t.title}
                >
                  {t.title}
                </button>
              ))}
              {dayTasks.length > 3 && (
                <span className="text-xs text-muted-foreground px-1">+{dayTasks.length - 3} 更多</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
