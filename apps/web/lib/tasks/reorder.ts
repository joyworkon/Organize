/**
 * 任务拖拽排序的纯函数部分。
 * sort_order 是 integer（015 迁移），不能用分数中点插入，
 * 因此重排后把组内 sort_order 归一为 0..n-1，只更新有变化的行。
 */

/** 把 dragId 移到 targetId 的前（after=false）或后（after=true），返回新顺序 */
export function reorderIds(ids: string[], dragId: string, targetId: string, after: boolean): string[] {
  if (dragId === targetId) return ids;
  if (!ids.includes(dragId) || !ids.includes(targetId)) return ids;
  const without = ids.filter((id) => id !== dragId);
  const targetIndex = without.indexOf(targetId);
  without.splice(after ? targetIndex + 1 : targetIndex, 0, dragId);
  return without;
}

/** 对比新顺序与现有 sort_order，返回需要持久化的最小更新集 */
export function computeSortOrderUpdates(
  rows: { id: string; sort_order: number }[],
  newOrder: string[]
): { id: string; sort_order: number }[] {
  const position = new Map(newOrder.map((id, index) => [id, index]));
  const updates: { id: string; sort_order: number }[] = [];
  for (const row of rows) {
    const next = position.get(row.id);
    if (next === undefined) continue;
    if (row.sort_order !== next) updates.push({ id: row.id, sort_order: next });
  }
  return updates;
}

/**
 * 把"组内新顺序"应用回完整任务数组（保持组外任务原位）。
 * 用于乐观更新：渲染顺序跟随数组顺序，仅改 sort_order 不会重排。
 */
export function applyReorderedGroup<T extends { id: string }>(all: T[], groupIdsInNewOrder: string[]): T[] {
  const inGroup = new Set(groupIdsInNewOrder);
  const byId = new Map(all.map((item) => [item.id, item]));
  const queue = [...groupIdsInNewOrder];
  return all.map((item) => {
    if (!inGroup.has(item.id)) return item;
    const next = queue.shift();
    return (next && byId.get(next)) || item;
  });
}
