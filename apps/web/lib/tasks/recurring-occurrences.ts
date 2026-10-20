import type { TaskWithTags } from "@organize/shared";
import { occurrencesBetween } from "./recurrence";

/** Calendar-only metadata; never pass a projection to a persistence callback. */
export interface CalendarTask extends TaskWithTags {
  recurringSource?: TaskWithTags;
}

export function recurringSource(task: CalendarTask): TaskWithTags {
  return task.recurringSource ?? task;
}

export function isRecurringProjection(task: CalendarTask): boolean {
  return Boolean(task.recurringSource);
}

/** Keep real tasks intact and add at most 400 read-only occurrences per source. */
export function projectRecurringTasks(tasks: TaskWithTags[], from: Date, to: Date): CalendarTask[] {
  const result: CalendarTask[] = [...tasks];
  for (const task of tasks) {
    if (!task.recurrence_rule || task.status === "done" || task.status === "cancelled" || task.deleted_at ||
        isRecurringProjection(task)) continue;
    const value = task.schedule_start_at || task.due_date;
    if (!value) continue;
    const start = new Date(value);
    const end = task.schedule_end_at ? new Date(task.schedule_end_at) : start;
    const duration = Math.max(0, end.getTime() - start.getTime());
    if (!Number.isFinite(duration)) continue;
    // Include occurrences starting before the visible range whose span still intersects it.
    const first = new Date(from.getTime() - duration);
    for (const date of occurrencesBetween(start, task.recurrence_rule, first, to)) {
      result.push({
        ...task,
        id: `${task.id}:recurring:${date.toISOString()}`,
        recurringSource: task,
        schedule_start_at: date.toISOString(),
        schedule_end_at: task.schedule_end_at ? new Date(date.getTime() + duration).toISOString() : null,
        due_date: date.toISOString(),
      });
    }
  }
  return result;
}
