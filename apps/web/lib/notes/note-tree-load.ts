import type { NoteTreeItem } from "@/lib/notes/tree";

/**
 * 笔记详情页「笔记树」（整库 notes 快照）加载结果落到 UI 状态的纯逻辑（供 page.tsx 接线并单测）：
 * - 成功：整体替换并清错（字段映射与旧的行内 map 完全一致）；
 * - 失败：保留上次成功快照——把加载失败伪装成「用户没有别的笔记」等于撒谎，
 *   会连带让子页面区显示「新建子页面」、面包屑丢父级；
 * - reliable：快照是否可作为「有无子页面」的判定依据。从未成功加载或最近一次失败时为
 *   false，离开页面的空笔记丢弃（lib/notes/empty-note.ts）必须把 hasChildren 视为
 *   「不确定 → 保留」，否则一篇空标题但有子页面的新笔记会被永久删除。
 * 与 lib/notes/backlinks-load.ts（#361）、linked-task-banner-load.ts（#363）同构。
 */

/** notes 表 select("id, title, icon, parent_note_id, updated_at") 的行形状 */
export interface NoteTreeRow {
  id: string;
  title: string | null;
  icon: string | null;
  parent_note_id: string | null;
  updated_at: string;
}

/** nextNoteTreeAfterLoad 的返回：UI 该落到什么快照、错误提示、快照是否可用于丢弃判定 */
export interface NoteTreeLoadPlan {
  notes: NoteTreeItem[];
  /** 非空表示当前处于加载失败状态；null 表示无错 */
  loadError: string | null;
  reliable: boolean;
}

export const NOTE_TREE_LOAD_ERROR_MESSAGE = "子页面加载失败";

export function nextNoteTreeAfterLoad({
  previous,
  data,
  error,
}: {
  /** 上次成功快照（调用方用 allNotesRef 读取，避免 effect 闭包旧值）；失败时原样返回（同引用，React 跳过重渲染） */
  previous: NoteTreeItem[];
  data: readonly NoteTreeRow[] | null;
  /** supabase-js 的 error 即失败事实；只用真值判断，不吞成 null */
  error: unknown;
}): NoteTreeLoadPlan {
  if (!error) {
    return {
      notes: (data ?? []).map((note) => ({
        id: note.id,
        title: note.title || null,
        icon: note.icon || null,
        parent_note_id: note.parent_note_id || null,
        updated_at: note.updated_at,
      })),
      loadError: null,
      reliable: true,
    };
  }
  return {
    notes: previous,
    loadError: NOTE_TREE_LOAD_ERROR_MESSAGE,
    reliable: false,
  };
}

/**
 * 空笔记丢弃用的 hasChildren：快照不可靠（从未成功加载或最近一次失败）时返回 true
 * （不确定就当有子页面，保留笔记）；可靠时如实按快照判断。
 */
export function hasChildrenForDiscard({
  notes,
  noteId,
  reliable,
}: {
  notes: readonly NoteTreeItem[];
  noteId: string;
  reliable: boolean;
}): boolean {
  if (!reliable) return true;
  return notes.some((n) => n.parent_note_id === noteId);
}
