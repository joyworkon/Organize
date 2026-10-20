import { getDescendantIds, type NoteTreeItem, type NoteTreeNode } from "@/lib/notes/tree";

/**
 * 侧栏笔记树「拖到另一篇笔记上成为其子页面」的合法性判断与持久化（拖放嵌套）。
 *
 * - canDropNoteOn：目标不是被拖笔记本身、也不是它的后代（否则成环）。子孙与被拖节点
 *   必然落在同一个侧栏分组段里（分组按顶层笔记归属、子页面跟随父页面），调用方用本段
 *   树的扁平行判断即完备；被拖节点不在本段（跨段 / 从笔记列表卡片拖来）时本段全部合法。
 * - persistNoteMove：与「移动到…」对话框相同的保存路径（原 app/(main)/notes/page-utils.ts，
 *   067 迁移说明见函数注释），page-utils 从此处 re-export，保持唯一实现。
 */

/** 树 → 扁平数组（DFS，先父后子），供 drop 判断 / 移动对话框候选使用 */
export function flattenNoteTree(nodes: readonly NoteTreeNode[]): NoteTreeItem[] {
  const items: NoteTreeItem[] = [];
  const walk = (branch: readonly NoteTreeNode[]) => {
    for (const node of branch) {
      const { children, ...item } = node;
      items.push(item);
      walk(children);
    }
  };
  walk(nodes);
  return items;
}

/** 目标行能否接收这次拖放：排除自身与后代；draggedId 为空 / 不在 items 时按合法处理 */
export function canDropNoteOn(
  items: readonly NoteTreeItem[],
  draggedId: string | null | undefined,
  targetId: string
): boolean {
  if (!draggedId) return true;
  if (draggedId === targetId) return false;
  return !getDescendantIds(items as NoteTreeItem[], draggedId).has(targetId);
}

/** 最小 supabase 形状：只用到 notes 的读 revision + 更新 */
export interface NoteMoveClient {
  from(table: "notes"): {
    select(columns: "content_revision"): { eq(col: "id", id: string): { single(): PromiseLike<{ data: { content_revision?: number | null } | null }> } };
    update(patch: { parent_note_id: string | null; content_revision: number }): { eq(col: "id", id: string): PromiseLike<{ error: unknown }> };
  };
}

/**
 * 持久化「移动到」/ 拖放嵌套：parent_note_id 在编辑器保存快照里，必须同步递增
 * content_revision，否则其他标签页的编辑器下次自动保存会把移动静默还原。
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

/** persistNoteRename 的最小 client 形状（title 版本） */
export interface NoteRenameClient {
  from(table: "notes"): {
    select(columns: "content_revision"): { eq(col: "id", id: string): { single(): PromiseLike<{ data: { content_revision?: number | null } | null }> } };
    update(patch: { title: string; content_revision: number }): { eq(col: "id", id: string): PromiseLike<{ error: unknown }> };
  };
}

/**
 * 持久化行内重命名：与 PATCH /api/notes/[id] 改标题同款「读 revision → update 并递增」，
 * 防止另一标签页打开的编辑器持旧 revision 自动保存把新标题静默还原。
 * onPersisted 只在写库成功后调用；失败抛出原错误。
 */
export async function persistNoteRename(
  client: NoteRenameClient,
  noteId: string,
  title: string,
  onPersisted: () => void,
): Promise<void> {
  const { data: current } = await client.from("notes").select("content_revision").eq("id", noteId).single();
  const { error } = await client
    .from("notes")
    .update({ title, content_revision: Number(current?.content_revision ?? 0) + 1 })
    .eq("id", noteId);
  if (error) throw error;
  onPersisted();
}
