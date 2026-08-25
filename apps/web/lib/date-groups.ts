/**
 * 列表页通用的日期分组工具：
 * - 笔记列表按 updated_at 分组：今天 / 昨天 / 本周 / 更早
 * - 待办列表按到期日分组：已逾期 / 今天 / 明天 / 未来 7 天 / 更晚 / 无日期
 * 所有函数接收 now 参数便于测试，组内顺序保持入数组顺序（调用方负责排序）。
 */

export interface DateGroup<T> {
  key: string;
  label: string;
  items: T[];
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function buildGroups<T>(
  items: T[],
  keyOf: (item: T) => string,
  order: readonly string[],
  labels: Record<string, string>
): DateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return order
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, label: labels[key], items: buckets.get(key)! }));
}

export type NoteDateGroupKey = "today" | "yesterday" | "week" | "earlier";

export const NOTE_DATE_GROUP_ORDER: readonly NoteDateGroupKey[] = [
  "today",
  "yesterday",
  "week",
  "earlier",
];

export const NOTE_DATE_GROUP_LABELS: Record<NoteDateGroupKey, string> = {
  today: "今天",
  yesterday: "昨天",
  week: "本周",
  earlier: "更早",
};

/** 本周按自然周（周一起算）；今天/昨天优先于本周。 */
export function noteDateGroupKey(iso: string, now: Date = new Date()): NoteDateGroupKey {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "earlier";
  const todayStart = startOfDay(now);
  const dayStart = startOfDay(date);
  if (dayStart.getTime() >= todayStart.getTime()) return "today";
  if (dayStart.getTime() >= addDays(todayStart, -1).getTime()) return "yesterday";
  // 周一为一周起点：getDay() 周日为 0，统一转成周一为 0
  const offsetFromMonday = (now.getDay() + 6) % 7;
  const weekStart = addDays(todayStart, -offsetFromMonday);
  if (dayStart.getTime() >= weekStart.getTime()) return "week";
  return "earlier";
}

export function groupNotesByDate<T extends { updated_at: string }>(
  notes: T[],
  now: Date = new Date()
): DateGroup<T>[] {
  return buildGroups(
    notes,
    (note) => noteDateGroupKey(note.updated_at, now),
    NOTE_DATE_GROUP_ORDER,
    NOTE_DATE_GROUP_LABELS
  );
}

export type TaskDateGroupKey =
  | "overdue"
  | "today"
  | "tomorrow"
  | "week"
  | "later"
  | "noDate";

export const TASK_DATE_GROUP_ORDER: readonly TaskDateGroupKey[] = [
  "overdue",
  "today",
  "tomorrow",
  "week",
  "later",
  "noDate",
];

export const TASK_DATE_GROUP_LABELS: Record<TaskDateGroupKey, string> = {
  overdue: "已逾期",
  today: "今天",
  tomorrow: "明天",
  week: "未来 7 天",
  later: "更晚",
  noDate: "无日期",
};

/** dateIso 为任务展示用日期（schedule_start_at || due_date），null 归入无日期。 */
export function taskDateGroupKey(
  dateIso: string | null | undefined,
  now: Date = new Date()
): TaskDateGroupKey {
  if (!dateIso) return "noDate";
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return "noDate";
  const todayStart = startOfDay(now);
  const dayStart = startOfDay(date);
  if (dayStart.getTime() < todayStart.getTime()) return "overdue";
  if (dayStart.getTime() < addDays(todayStart, 1).getTime()) return "today";
  if (dayStart.getTime() < addDays(todayStart, 2).getTime()) return "tomorrow";
  if (dayStart.getTime() < addDays(todayStart, 7).getTime()) return "week";
  return "later";
}

export function groupTasksByDate<T>(
  tasks: T[],
  dateOf: (task: T) => string | null,
  now: Date = new Date()
): DateGroup<T>[] {
  return buildGroups(
    tasks,
    (task) => taskDateGroupKey(dateOf(task), now),
    TASK_DATE_GROUP_ORDER,
    TASK_DATE_GROUP_LABELS
  );
}
