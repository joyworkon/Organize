import type { NoteTreeNode } from "@/lib/notes/tree";

/**
 * 侧栏笔记树「折叠状态」的持久化与跨实例同步（展开记忆）：
 * - 持久化到 localStorage 共享键（JSON 数组）。侧栏按分组渲染多个树实例，各实例
 *   读-合并-写同一个键，避免互相覆盖；解析失败/存储不可用时静默回退为空集合。
 * - 每次写入后由调用方广播 SIDEBAR_TREE_COLLAPSED_EVENT，其它实例监听后重读，
 *   保证「拖放成功后自动展开目标父级」这类跨段展开立刻生效。
 */

export const SIDEBAR_TREE_COLLAPSED_KEY = "organize-sidebar-note-tree-collapsed";
export const SIDEBAR_TREE_COLLAPSED_EVENT = "organize:sidebar-note-tree-collapsed-changed";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** 读取已折叠 id 集合；任何异常（无存储 / 非法 JSON / 非字符串数组）都回退为空 */
export function loadCollapsedTreeIds(storage: StorageLike): Set<string> {
  try {
    const raw = storage.getItem(SIDEBAR_TREE_COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

/** 全量写入（异常静默）；返回传入集合本身便于调用方 setState */
export function persistCollapsedTreeIds(
  storage: StorageLike,
  ids: ReadonlySet<string>
): Set<string> {
  try {
    storage.setItem(SIDEBAR_TREE_COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* 存储不可用时只保留内存态 */
  }
  return new Set(ids);
}

/** 读-合并-翻转单个 id-写回；返回翻转后的新集合（供 setState + 广播） */
export function toggleCollapsedTreeId(storage: StorageLike, id: string): Set<string> {
  const next = loadCollapsedTreeIds(storage);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return persistCollapsedTreeIds(storage, next);
}

/**
 * 把若干 id 从折叠集合里移除（展开）；读-合并-写回。
 * 已在展开态时不写存储，返回当前集合。
 */
export function expandTreeIds(
  storage: StorageLike,
  ids: Iterable<string>
): Set<string> {
  const next = loadCollapsedTreeIds(storage);
  let changed = false;
  for (const id of ids) {
    if (next.delete(id)) changed = true;
  }
  if (!changed) return next;
  return persistCollapsedTreeIds(storage, next);
}

/**
 * 在树里定位 noteId 的祖先 id 链（从顶层到直接父级）。
 * noteId 不在树里返回 null（调用方据此判断「不是我的子树」）；是顶层节点返回 []。
 * 环数据防御：访问过的 id 不再重复进入。
 */
export function findTreeAncestorIds(
  nodes: readonly NoteTreeNode[],
  noteId: string
): string[] | null {
  const walk = (
    branch: readonly NoteTreeNode[],
    trail: string[]
  ): string[] | null => {
    for (const node of branch) {
      if (node.id === noteId) return trail;
      if (trail.includes(node.id)) continue;
      const found = walk(node.children, [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes, []);
}
