import type { TaskPriority, TaskWithTags } from "@organize/shared";

/**
 * 日历「筛选」条件：标签（多选，任一命中）/ 优先级（多选，任一命中）/ 关键词
 * （标题与描述的大小写不敏感包含匹配）。三类条件之间为 AND。
 * 默认全空 = 不筛选，老用户首屏不变。
 * 标签与优先级按用户持久化到 localStorage（关键词不持久化，刷新后清空）；
 * 读写都是纯函数，便于单测。持久化与校验模式与 calendar-view-options 一致。
 */

export interface CalendarTaskFilter {
  tagIds: string[];
  priorities: TaskPriority[];
  query: string;
}

export const DEFAULT_CALENDAR_TASK_FILTER: CalendarTaskFilter = {
  tagIds: [],
  priorities: [],
  query: "",
};

const STORAGE_PREFIX = "organize:calendar-filters:";
const VALID_PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low"];

export function calendarTaskFilterStorageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? "anonymous"}`;
}

/** 任一条件生效即视为「筛选中」（关键词按去首尾空白后非空计）。 */
export function isCalendarFilterActive(filter: CalendarTaskFilter): boolean {
  return filter.tagIds.length > 0 || filter.priorities.length > 0 || filter.query.trim().length > 0;
}

/** 生效条件条数：每个标签 / 每个优先级各算一条，关键词整体算一条。 */
export function activeCalendarFilterCount(filter: CalendarTaskFilter): number {
  return filter.tagIds.length + filter.priorities.length + (filter.query.trim() ? 1 : 0);
}

/**
 * 套用筛选：标签 OR、优先级 OR、关键词包含匹配，组间 AND；空筛选恒等。
 * 重复投影展开时整体展开自源任务（recurring-occurrences 的 `...task`），
 * tags / priority 随之继承，故投影与源任务口径一致，无需特判。
 */
export function applyCalendarTaskFilter(tasks: TaskWithTags[], filter: CalendarTaskFilter): TaskWithTags[] {
  if (!isCalendarFilterActive(filter)) return tasks;
  const tagIds = new Set(filter.tagIds);
  const priorities = new Set(filter.priorities);
  const query = filter.query.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    if (tagIds.size > 0 && !(task.tags ?? []).some((tag) => tagIds.has(tag.id))) return false;
    if (priorities.size > 0 && !priorities.has(task.priority)) return false;
    if (query) {
      const haystack = `${task.title}\n${task.description ?? ""}`.toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/** 剔除已删除的标签 id（标签列表加载完成后调用）；无变化时返回原对象。 */
export function pruneCalendarTaskFilterTags(
  filter: CalendarTaskFilter,
  validTagIds: ReadonlySet<string>
): CalendarTaskFilter {
  const kept = filter.tagIds.filter((id) => validTagIds.has(id));
  if (kept.length === filter.tagIds.length) return filter;
  return { ...filter, tagIds: kept };
}

/** 解析并校验存储值；非法整体作废（回落不筛选）。关键词不持久化，读出恒为空。 */
export function parseCalendarTaskFilter(raw: string | null): CalendarTaskFilter | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = parsed as Partial<{ tagIds: unknown; priorities: unknown }>;
  if (value.tagIds !== undefined && (!Array.isArray(value.tagIds) || value.tagIds.some((id) => typeof id !== "string"))) {
    return null;
  }
  if (
    value.priorities !== undefined &&
    (!Array.isArray(value.priorities) || value.priorities.some((p) => !VALID_PRIORITIES.includes(p as TaskPriority)))
  ) {
    return null;
  }
  return {
    tagIds: value.tagIds ?? [],
    priorities: (value.priorities ?? []) as TaskPriority[],
    query: "",
  };
}

/** 读取持久化筛选；validTagIds 提供时顺带剔除已删除的标签 id。 */
export function loadCalendarTaskFilter(
  storage: Pick<Storage, "getItem"> | null,
  userId: string | null,
  validTagIds?: ReadonlySet<string>
): CalendarTaskFilter {
  if (!storage) return { ...DEFAULT_CALENDAR_TASK_FILTER };
  try {
    const parsed = parseCalendarTaskFilter(storage.getItem(calendarTaskFilterStorageKey(userId))) ?? {
      ...DEFAULT_CALENDAR_TASK_FILTER,
    };
    return validTagIds ? pruneCalendarTaskFilterTags(parsed, validTagIds) : parsed;
  } catch {
    return { ...DEFAULT_CALENDAR_TASK_FILTER };
  }
}

/** 只持久化标签与优先级；关键词属临时条件，刷新后不恢复。 */
export function saveCalendarTaskFilter(
  storage: Pick<Storage, "setItem"> | null,
  userId: string | null,
  filter: CalendarTaskFilter
): void {
  if (!storage) return;
  try {
    storage.setItem(
      calendarTaskFilterStorageKey(userId),
      JSON.stringify({ tagIds: filter.tagIds, priorities: filter.priorities })
    );
  } catch {
    // 隐私模式 / 配额满：静默失败，本次会话内筛选仍生效。
  }
}
