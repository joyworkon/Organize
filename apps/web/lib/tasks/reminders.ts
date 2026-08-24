import type { Task, TaskReminder } from "@organize/shared";

export const TASK_REMINDER_PRESETS = [
  { value: "start:0", anchor: "start", offsetMinutes: 0, label: "开始时" },
  { value: "start:-10", anchor: "start", offsetMinutes: -10, label: "开始前 10 分钟" },
  { value: "start:-30", anchor: "start", offsetMinutes: -30, label: "开始前 30 分钟" },
  { value: "start:-60", anchor: "start", offsetMinutes: -60, label: "开始前 1 小时" },
  { value: "start:-1440", anchor: "start", offsetMinutes: -1440, label: "开始前 1 天" },
  { value: "end:0", anchor: "end", offsetMinutes: 0, label: "结束时" },
  { value: "end:-10", anchor: "end", offsetMinutes: -10, label: "结束前 10 分钟" },
  { value: "end:-60", anchor: "end", offsetMinutes: -60, label: "结束前 1 小时" },
] as const;

export function reminderValue(reminder: Pick<TaskReminder, "anchor" | "offset_minutes">) {
  return `${reminder.anchor}:${reminder.offset_minutes}`;
}

export function reminderLabel(reminder: Pick<TaskReminder, "anchor" | "offset_minutes">) {
  return (
    TASK_REMINDER_PRESETS.find((preset) => preset.value === reminderValue(reminder))?.label
    ?? `${reminder.anchor === "end" ? "结束" : "开始"}${formatOffset(reminder.offset_minutes)}`
  );
}

export function formatOffset(offsetMinutes: number) {
  if (offsetMinutes === 0) return "时";
  const direction = offsetMinutes < 0 ? "前" : "后";
  const absolute = Math.abs(offsetMinutes);
  if (absolute % 1440 === 0) return `${direction} ${absolute / 1440} 天`;
  if (absolute % 60 === 0) return `${direction} ${absolute / 60} 小时`;
  return `${direction} ${absolute} 分钟`;
}

export function reminderFireAt(
  task: Pick<Task, "schedule_start_at" | "schedule_end_at" | "due_date">,
  reminder: Pick<TaskReminder, "anchor" | "offset_minutes">
) {
  const anchor =
    reminder.anchor === "end"
      ? task.schedule_end_at || task.schedule_start_at || task.due_date
      : task.schedule_start_at || task.due_date;
  if (!anchor) return null;
  const timestamp = new Date(anchor).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + reminder.offset_minutes * 60_000);
}
