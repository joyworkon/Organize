"use client";

import { Repeat2 } from "@/components/icons";
import { getTaskDate, type AgendaEntry } from "@/lib/tasks/calendar-agenda";
import { isRecurringProjection, recurringSource } from "@/lib/tasks/recurring-occurrences";
import { cn } from "@/lib/utils";
import type { TaskWithTags } from "@organize/shared";

/** 月视图与手机月视图共用的文案常量与任务呈现小件，避免两个组件文件互相引用。 */

export const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const WEEKDAYS_SHORT = ["一", "二", "三", "四", "五", "六", "日"];

export function weekdayLabel(date: Date): string {
  return WEEKDAYS[(date.getDay() + 6) % 7];
}

/**
 * 日历内就地勾选完成：span 实现（宿主多为 <button>，嵌套 button 非法），
 * role="checkbox" + aria-checked，Space/Enter 切换。
 * 点击只切换完成状态：pointerdown / click 都不冒泡，不触发打开 peek、不触发拖拽。
 * 重复任务投影不渲染（return null），调用方无需再包 isRecurringProjection 条件。
 * ::after 扩大触控热区而不改变布局；调用方可用 className 覆盖尺寸。
 */
export function CalendarTaskCheckbox({
  task,
  onToggle,
  className,
}: {
  task: TaskWithTags;
  onToggle?: (task: TaskWithTags) => void;
  className?: string;
}) {
  if (isRecurringProjection(task)) return null;
  const done = task.status === "done";
  // 无切换回调（测试 / 未接线）时退回纯展示方框，外观与历史行为一致。
  if (!onToggle) {
    return (
      <span
        aria-hidden
        className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded border border-current/40", className)}
      >
        {done ? "✓" : ""}
      </span>
    );
  }
  const toggle = () => onToggle(recurringSource(task));
  return (
    <span
      role="checkbox"
      aria-checked={done}
      aria-label={`完成任务：${task.title}`}
      tabIndex={0}
      data-calendar-task-checkbox=""
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        toggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        }
      }}
      className={cn(
        "relative grid h-3.5 w-3.5 shrink-0 place-items-center rounded border border-current/40 text-[10px] font-semibold leading-none",
        "after:absolute after:-inset-1.5 after:content-['']",
        "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className
      )}
    >
      {done ? "✓" : ""}
    </span>
  );
}

export function recurringPresentation(task: TaskWithTags) {
  const projected = isRecurringProjection(task);
  const date = getTaskDate(task);
  return {
    "data-recurring-projection": projected ? "true" : undefined,
    "aria-label": task.recurrence_rule
      ? `${task.title} · 重复${projected && date ? ` · 预计 ${date.getMonth() + 1}月${date.getDate()}日` : ""}`
      : undefined,
    title: projected ? "这是重复任务的后续发生，修改会作用于整个系列" : undefined,
  };
}

export function TaskRepeatIcon({ task }: { task: TaskWithTags }) {
  return task.recurrence_rule ? <Repeat2 aria-hidden="true" data-recurring-icon className="mr-1 inline-block h-3 w-3 shrink-0 align-text-bottom" /> : null;
}

export function timeLabel(task: TaskWithTags): string {
  const date = getTaskDate(task);
  if (!date || task.all_day) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 议程条目 meta 文案（手机月议程与桌面日程视图共用）：
 * 续日「跨天 · 第 n/N 天」；首日定时「HH:MM · 共 N 天」/ 全天「全天 · 共 N 天」，单日仅时刻或「全天」。
 */
export function agendaEntryMeta(entry: AgendaEntry): string {
  const { task, spanIndex, spanDays } = entry;
  if (spanIndex > 0) return `跨天 · 第 ${spanIndex + 1}/${spanDays} 天`;
  const start = getTaskDate(task);
  const clock = task.all_day
    ? "全天"
    : start?.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) ?? "";
  return spanDays > 1 ? `${clock} · 共 ${spanDays} 天` : clock;
}
