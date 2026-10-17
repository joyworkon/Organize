import type { TagColor, TagWithCount } from "@organize/shared";

/** tags 表行（页面 select("id, name, color, created_at") 查回的形状） */
export interface TagRow {
  id: string;
  name: string;
  color?: TagColor | null;
}

/** 单类关联查询结果：supabase 的 `{ data, error }` */
export interface TagLinkResult {
  data: Array<{ tag_id: string }> | null;
  error?: { message: string } | null;
}

/**
 * 由四张关联表（item_tags / note_tags / task_tags / lesson_tags）的查询结果
 * 算出每个标签的使用计数。任一类 error 非空时 countsFailed=true（标签本身照常返回，
 * 计数不可信，渲染层应显示「使用数加载失败」而不是把失败当成 0）。
 */
export function buildTagCounts(
  tagRows: TagRow[],
  userId: string,
  results: {
    reading: TagLinkResult;
    note: TagLinkResult;
    task: TagLinkResult;
    lesson: TagLinkResult;
  }
): { tags: TagWithCount[]; countsFailed: boolean } {
  const countsFailed = (["reading", "note", "task", "lesson"] as const).some(
    (kind) => results[kind].error
  );

  const countKey = {
    reading: "reading_item_count",
    note: "note_count",
    task: "task_count",
    lesson: "lesson_count",
  } as const;
  const zero = { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
  const countMap = new Map<string, typeof zero>();
  for (const kind of ["reading", "note", "task", "lesson"] as const) {
    for (const row of results[kind].data ?? []) {
      const entry = { ...(countMap.get(row.tag_id) ?? zero) };
      entry[countKey[kind]] += 1;
      countMap.set(row.tag_id, entry);
    }
  }

  const tags: TagWithCount[] = tagRows.map((t) => ({
    id: t.id,
    user_id: userId,
    name: t.name,
    color: t.color || "blue",
    ...(countMap.get(t.id) ?? zero),
  }));

  return { tags, countsFailed };
}
