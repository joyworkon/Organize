/**
 * 自由元素图层顺序。底→顶按 zIndex 升序，相同 zIndex 时数组中更早的在下
 * （与 DOM 同 z-index 时靠后的画在上面一致）。
 * 顺序没变时不改写 zIndex，避免「已在顶层再置于顶层」制造空撤销。
 */

export interface FreeZItem {
  id: string;
  zIndex: number;
}

export interface FreeZPatch {
  itemId: string;
  zIndex: number;
}

export type FreeLayerAction = "front" | "back" | "forward" | "backward";

function stackOrder(items: readonly FreeZItem[]): string[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.zIndex - b.item.zIndex || a.index - b.index)
    .map((entry) => entry.item.id);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** 选中项整组移到未选中项之上或之下，组内相对顺序保持。 */
function placeSelection(order: readonly string[], selected: ReadonlySet<string>, edge: "front" | "back"): string[] {
  const picked: string[] = [];
  const rest: string[] = [];
  for (const id of order) {
    if (selected.has(id)) picked.push(id);
    else rest.push(id);
  }
  return edge === "front" ? [...rest, ...picked] : [...picked, ...rest];
}

/**
 * 上移/下移一层：每个选中岛与移动方向上紧邻的一个未选中项交换。
 * 从移动方向的远端往回扫，选中项不会互相穿过，连续选中会作为一组跨过那一个邻居。
 */
function stepOrder(order: readonly string[], selected: ReadonlySet<string>, direction: "forward" | "backward"): string[] {
  const next = [...order];
  if (direction === "forward") {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(next[index]) && !selected.has(next[index + 1])) {
        const above = next[index + 1];
        next[index + 1] = next[index];
        next[index] = above;
      }
    }
    return next;
  }
  for (let index = 1; index < next.length; index += 1) {
    if (selected.has(next[index]) && !selected.has(next[index - 1])) {
      const below = next[index - 1];
      next[index - 1] = next[index];
      next[index] = below;
    }
  }
  return next;
}

/** 只返回 zIndex 有变化的项。新顺序用连续的 1..n，落在校验范围 0..10000 内（自由元素上限 100）。 */
export function reorderFreeZIndexes(
  allItems: readonly FreeZItem[],
  selectedIds: readonly string[],
  action: FreeLayerAction,
): FreeZPatch[] {
  if (allItems.length === 0 || selectedIds.length === 0) return [];
  const known = new Set(allItems.map((item) => item.id));
  const selected = new Set(selectedIds.filter((id) => known.has(id)));
  if (selected.size === 0) return [];
  const order = stackOrder(allItems);
  const next = action === "front" || action === "back"
    ? placeSelection(order, selected, action === "front" ? "front" : "back")
    : stepOrder(order, selected, action === "forward" ? "forward" : "backward");
  if (sameIds(order, next)) return [];
  const zOf = new Map(allItems.map((item) => [item.id, item.zIndex]));
  const patches: FreeZPatch[] = [];
  next.forEach((id, index) => {
    const zIndex = index + 1;
    if (zOf.get(id) !== zIndex) patches.push({ itemId: id, zIndex });
  });
  return patches;
}
