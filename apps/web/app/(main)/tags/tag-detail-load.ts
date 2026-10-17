import type { LessonWithTags, NoteWithTags, ReadingItem, Tag, TaskWithTags } from "@organize/shared";

/** 标签详情四类条目（页面 detailItems state 的形状） */
export interface TagDetailItems {
  readings: ReadingItem[];
  notes: NoteWithTags[];
  tasks: TaskWithTags[];
  lessons: LessonWithTags[];
}

/** 单类查询结果：supabase 的 `{ data, error }`，或空 id 列表时 `Promise.resolve({ data: [] })` */
export interface DetailLoadResult<T> {
  data: T[] | null;
  error?: { message: string } | null;
}

/**
 * 由标签详情的各查询结果（四类关联、四类实体、任务/复盘二次 tag link、全量 tags）
 * 拼出四类条目并判定是否加载失败。任一查询 error 非空 → loadError 有值，此时 items
 * 不可信（调用方不得 setDetailItems，保留上次成功快照），不能把加载失败伪装成
 * 「该分类下暂无内容」；全部成功 → loadError 为 null 且 items 为拼装结果。
 * allTags / 二次 tag link 失败同样算 loadError（否则任务/复盘会丢标签徽章，也不诚实）。
 */
export function buildTagDetailItems(results: {
  itemLinks: DetailLoadResult<{ item_id: string }>;
  noteLinks: DetailLoadResult<{ note_id: string }>;
  taskLinks: DetailLoadResult<{ task_id: string }>;
  lessonLinks: DetailLoadResult<{ lesson_id: string }>;
  readings: DetailLoadResult<ReadingItem>;
  notes: DetailLoadResult<NoteWithTags>;
  tasks: DetailLoadResult<TaskWithTags>;
  lessons: DetailLoadResult<LessonWithTags>;
  taskTagLinks: DetailLoadResult<{ task_id: string; tag_id: string }>;
  lessonTagLinks: DetailLoadResult<{ lesson_id: string; tag_id: string }>;
  allTags: DetailLoadResult<Tag>;
}): { items: TagDetailItems; loadError: string | null } {
  const firstError = (Object.values(results) as Array<DetailLoadResult<unknown>>).find(
    (result) => result.error
  )?.error;
  const loadError = firstError?.message || (firstError ? "加载标签内容失败" : null);

  // 任务/复盘的 tags 徽章：全量 tags → tagMap，二次 tag link 按实体分组
  const tagMap = new Map((results.allTags.data ?? []).map((t) => [t.id, t]));

  const taskTagsByTask = new Map<string, Tag[]>();
  for (const link of results.taskTagLinks.data ?? []) {
    const tag = tagMap.get(link.tag_id);
    if (tag) {
      const existing = taskTagsByTask.get(link.task_id) ?? [];
      existing.push(tag);
      taskTagsByTask.set(link.task_id, existing);
    }
  }

  const lessonTagsByLesson = new Map<string, Tag[]>();
  for (const link of results.lessonTagLinks.data ?? []) {
    const tag = tagMap.get(link.tag_id);
    if (tag) {
      const existing = lessonTagsByLesson.get(link.lesson_id) ?? [];
      existing.push(tag);
      lessonTagsByLesson.set(link.lesson_id, existing);
    }
  }

  return {
    items: {
      readings: results.readings.data ?? [],
      notes: results.notes.data ?? [],
      tasks: (results.tasks.data ?? []).map((t) => ({ ...t, tags: taskTagsByTask.get(t.id) ?? [] })),
      lessons: (results.lessons.data ?? []).map((l) => ({ ...l, tags: lessonTagsByLesson.get(l.id) ?? [] })),
    },
    loadError,
  };
}
