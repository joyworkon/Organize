import type { NoteTreeItem } from "@/lib/notes/tree";

/**
 * 侧边栏「笔记」树（notes 快照含 is_pinned）加载结果落到 UI 状态的纯逻辑（供 sidebar.tsx 接线并单测）：
 * - 成功：整体替换并清错（字段映射与旧的行内 map 完全一致，含 is_pinned: !!is_pinned）；
 * - 失败：保留上次成功快照（previous 为 null 表示从未成功加载过）——把加载失败伪装成
 *   「还没有笔记」等于撒谎。
 * 与 lib/notes/note-tree-load.ts（#381，详情页/首页整库树，行形状无 is_pinned）同构但独立，
 * 不要合并：两边 select 列与映射约定不同。
 */

/** notes 表 select("id, title, icon, parent_note_id, updated_at, is_pinned") 的行形状 */
export interface SidebarNoteRow {
  id: string;
  title: string | null;
  icon: string | null;
  parent_note_id: string | null;
  updated_at: string;
  is_pinned?: boolean | null;
}

/** 映射后喂给 buildNoteTree 的行（成功路径字段与旧行内 map 完全一致） */
export interface SidebarNoteItem extends NoteTreeItem {
  title: string | null;
  icon: string | null;
  parent_note_id: string | null;
  updated_at: string;
  is_pinned: boolean;
}

export const SIDEBAR_NOTE_TREE_LOAD_ERROR_MESSAGE = "笔记加载失败";

/**
 * previous 为 null 表示从未成功加载过；失败时 rows 原样返回 previous（同引用），
 * 调用方据此「不覆盖 noteTree，只置错误提示」。
 */
export function nextSidebarNoteTreeAfterLoad({
  previous,
  data,
  error,
}: {
  previous: SidebarNoteItem[] | null;
  data: readonly SidebarNoteRow[] | null;
  /** supabase-js 的 error 即失败事实；只用真值判断，不吞成 null */
  error: unknown;
}): { rows: SidebarNoteItem[] | null; loadError: string | null } {
  if (!error) {
    return {
      rows: (data ?? []).map((note) => ({
        id: note.id,
        title: note.title || null,
        icon: note.icon || null,
        parent_note_id: note.parent_note_id || null,
        updated_at: note.updated_at,
        is_pinned: !!note.is_pinned,
      })),
      loadError: null,
    };
  }
  return { rows: previous, loadError: SIDEBAR_NOTE_TREE_LOAD_ERROR_MESSAGE };
}
