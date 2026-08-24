import type {
  Task,
  TaskCategory,
  TaskPriority,
  TaskRecurrenceRule,
} from "@organize/shared";

export interface TaskTemplateSnapshot {
  title: string;
  description: string | null;
  priority: TaskPriority;
  category: TaskCategory;
  list_id: string | null;
  estimated_minutes: number | null;
  all_day: boolean;
  timezone: string | null;
  recurrence_rule: TaskRecurrenceRule | null;
}

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
const CATEGORIES: TaskCategory[] = ["work", "study", "life"];
const FREQUENCIES: TaskRecurrenceRule["frequency"][] = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recurrenceRule(value: unknown): TaskRecurrenceRule | null {
  if (!value || typeof value !== "object") return null;
  const frequency = (value as { frequency?: unknown }).frequency;
  if (!FREQUENCIES.includes(frequency as TaskRecurrenceRule["frequency"])) return null;
  return { frequency: frequency as TaskRecurrenceRule["frequency"], interval: 1 };
}

export function normalizeTaskTemplate(
  value: Record<string, unknown>,
  fallbackTitle = "未命名任务"
): TaskTemplateSnapshot {
  const estimated = Number(value.estimated_minutes);
  return {
    title: nullableText(value.title) || fallbackTitle,
    description: nullableText(value.description),
    priority: PRIORITIES.includes(value.priority as TaskPriority)
      ? (value.priority as TaskPriority)
      : "medium",
    category: CATEGORIES.includes(value.category as TaskCategory)
      ? (value.category as TaskCategory)
      : "work",
    list_id: nullableText(value.list_id),
    estimated_minutes:
      Number.isFinite(estimated) && estimated > 0 ? Math.round(estimated) : null,
    all_day: value.all_day === true,
    timezone: nullableText(value.timezone),
    recurrence_rule: recurrenceRule(value.recurrence_rule),
  };
}

export function buildTaskTemplateSnapshot(
  task: Pick<
    Task,
    | "title"
    | "description"
    | "priority"
    | "category"
    | "list_id"
    | "estimated_minutes"
    | "all_day"
    | "timezone"
    | "recurrence_rule"
  >
): TaskTemplateSnapshot {
  return normalizeTaskTemplate(
    {
      title: task.title,
      description: task.description,
      priority: task.priority,
      category: task.category,
      list_id: task.list_id,
      estimated_minutes: task.estimated_minutes,
      all_day: task.all_day,
      timezone: task.timezone,
      recurrence_rule: task.recurrence_rule,
    },
    task.title
  );
}

export function buildTaskFromTemplate(
  snapshot: TaskTemplateSnapshot,
  userId: string,
  options: { listId: string | null; dueDate: string | null }
) {
  return {
    user_id: userId,
    title: snapshot.title,
    description: snapshot.description,
    status: "todo" as const,
    priority: snapshot.priority,
    category: snapshot.category,
    list_id: options.listId,
    estimated_minutes: snapshot.estimated_minutes,
    is_pinned: false,
    sort_order: 0,
    schedule_start_at: options.dueDate,
    schedule_end_at: null,
    due_date: options.dueDate,
    all_day: snapshot.all_day,
    timezone: snapshot.timezone,
    recurrence_rule: snapshot.recurrence_rule,
  };
}
