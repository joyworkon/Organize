import type { CanvasCommandResult, CanvasDoc } from "./model";

export function hasLockedFreeItems(doc: CanvasDoc, itemIds: readonly string[]): boolean {
  return doc.freeItems.some((item) => itemIds.includes(item.id) && item.locked === true);
}

export function allFreeItemsLocked(doc: CanvasDoc, itemIds: readonly string[]): boolean {
  const items = doc.freeItems.filter((item) => itemIds.includes(item.id));
  return items.length > 0 && items.every((item) => item.locked === true);
}

/** One history transaction, preserving the current single/multiple selection. */
export function setFreeItemsLocked(
  doc: CanvasDoc,
  args: { itemIds: readonly string[]; locked: boolean },
): CanvasCommandResult & { rejected?: string } {
  const ids = new Set(args.itemIds);
  const items = doc.freeItems.filter((item) => ids.has(item.id));
  if (!items.length) return { doc, rejected: "未找到自由元素" };
  if (items.every((item) => (item.locked === true) === args.locked)) return { doc };
  return { doc: { ...doc, freeItems: doc.freeItems.map((item) =>
    ids.has(item.id) ? { ...item, locked: args.locked } : item) } };
}
