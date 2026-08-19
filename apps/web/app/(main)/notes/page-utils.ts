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

/**
 * 本地排序（与服务端 order 一致：is_pinned desc → sortBy asc/desc）。
 * 置顶/取消置顶后调用，让笔记立即跳到正确分组位置，
 * 而不是原地不动等下次刷新。
 */
export function sortNotesLocal(
  notes: NoteWithTags[],
  sortBy: SortField,
  sortOrder: SortOrder
): NoteWithTags[] {
  const dir = sortOrder === "asc" ? 1 : -1;
  return [...notes].sort((a, b) => {
    if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
    if (sortBy === "title") {
      return (a.title || "").localeCompare(b.title || "", "zh-CN") * dir;
    }
    const av = new Date(a[sortBy] || 0).getTime();
    const bv = new Date(b[sortBy] || 0).getTime();
    return (av - bv) * dir;
  });
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
