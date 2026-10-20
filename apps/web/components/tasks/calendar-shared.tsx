"use client";

import { Repeat2 } from "@/components/icons";
import { getTaskDate } from "@/lib/tasks/calendar-agenda";
import { isRecurringProjection } from "@/lib/tasks/recurring-occurrences";
import type { TaskWithTags } from "@organize/shared";

/** 月视图与手机月视图共用的文案常量与任务呈现小件，避免两个组件文件互相引用。 */

export const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const WEEKDAYS_SHORT = ["一", "二", "三", "四", "五", "六", "日"];

export function weekdayLabel(date: Date): string {
  return WEEKDAYS[(date.getDay() + 6) % 7];
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
