import type { NoteWithTags } from "@organize/shared";

export type SortField = "updated_at" | "created_at" | "title";
export type SortOrder = "asc" | "desc";

/** 排序字段文案单源：下拉选项与触发器标签共用，避免两处各写一遍 */
export const SORT_FIELD_LABEL: Record<SortField, string> = {
  updated_at: "更新时间",
  created_at: "创建时间",
  title: "标题",
};

export const SORT_ORDER_LABEL: Record<SortOrder, string> = {
  desc: "降序",
  asc: "升序",
};

/** 排序触发器标签：「更新时间 · 降序」 */
export function sortSummary(field: SortField, order: SortOrder): string {
  return `${SORT_FIELD_LABEL[field]} · ${SORT_ORDER_LABEL[order]}`;
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

/**
 * 标签筛选查询（note_tags.select(note_id).in(tag_id, ...)）结果的三态判定：
 * - failed：查询出错——必须走与主查询相同的失败分支（提示 + 保留旧列表），
 *   不能把加载失败伪装成「筛选结果为空」；
 * - empty：查询成功但 0 行——确实没有笔记带这些标签，清空列表（显示「没有找到匹配的笔记」）；
 * - ok：返回去重后的 note_id 集合，交给主查询 .in("id", scopedIds)。
 */
export type TagFilterPlan =
  | { status: "failed" }
  | { status: "empty" }
  | { status: "ok"; scopedIds: string[] };

export function planTagFilter({
  data,
  error,
}: {
  data: readonly { note_id: string | null }[] | null;
  error: unknown;
}): TagFilterPlan {
  if (error) return { status: "failed" };
  if (!data || data.length === 0) return { status: "empty" };
  return {
    status: "ok",
    scopedIds: Array.from(new Set(data.map((row) => row.note_id as string))),
  };
}

/** 最小 supabase 形状：只用到 notes 的读 revision + 更新 */
export interface NoteMoveClient {
  from(table: "notes"): {
    select(columns: "content_revision"): { eq(col: "id", id: string): { single(): PromiseLike<{ data: { content_revision?: number | null } | null }> } };
    update(patch: { parent_note_id: string | null; content_revision: number }): { eq(col: "id", id: string): PromiseLike<{ error: unknown }> };
  };
}

/**
 * 持久化「移动到」：parent_note_id 在编辑器保存快照里，必须同步递增 content_revision，
 * 否则其他标签页的编辑器下次自动保存会把移动静默还原。
 * onPersisted 只在写库成功后调用（用于广播 organize:notes-changed）——提前广播会让
 * 侧栏树/列表在写入前取到旧父级。失败抛出原错误。
 */
export async function persistNoteMove(
  client: NoteMoveClient,
  noteId: string,
  nextParentId: string | null,
  onPersisted: () => void,
): Promise<void> {
  const { data: current } = await client.from("notes").select("content_revision").eq("id", noteId).single();
  const { error } = await client
    .from("notes")
    .update({ parent_note_id: nextParentId, content_revision: Number(current?.content_revision ?? 0) + 1 })
    .eq("id", noteId);
  if (error) throw error;
  onPersisted();
}
