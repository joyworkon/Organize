import type { NoteWithTags } from "@organize/shared";

export type SortField = "updated_at" | "created_at" | "title";
export type SortOrder = "asc" | "desc";

/** 排序字段循环：更新时间 → 创建时间 → 标题 → 更新时间 */
export function nextSortField(current: SortField): SortField {
  const fields: SortField[] = ["updated_at", "created_at", "title"];
  const idx = fields.indexOf(current);
  return fields[(idx + 1) % fields.length];
}

/** 本地更新单篇笔记的置顶状态（不可变更新，供乐观 UI 与失败回滚复用） */
export function applyPinned(
  notes: NoteWithTags[],
  id: string,
  pinned: boolean
): NoteWithTags[] {
  return notes.map((n) => (n.id === id ? { ...n, is_pinned: pinned } : n));
}

/** 本地批量更新置顶状态 */
export function applyPinnedBatch(
  notes: NoteWithTags[],
  ids: ReadonlySet<string>,
  pinned: boolean
): NoteWithTags[] {
  return notes.map((n) => (ids.has(n.id) ? { ...n, is_pinned: pinned } : n));
}

/** 本地移除若干笔记（删除成功后同步列表） */
export function removeNotes(
  notes: NoteWithTags[],
  ids: ReadonlySet<string>
): NoteWithTags[] {
  return notes.filter((n) => !ids.has(n.id));
}
