import { deleteFreeItem, updateFreeItem } from "@/lib/canvas/commands";
import type { CanvasStore } from "./canvas-store";

/** 一次 apply 移动若干自由元素。不带回单个 free 焦点，避免多选塌缩。 */
export function applyMoveFreeItems(
  store: CanvasStore,
  moves: readonly { itemId: string; x: number; y: number }[],
  opts?: { coalesceKey?: string },
): void {
  if (moves.length === 0) return;
  store.getState().apply("移动自由容器", (doc) => {
    let next = doc;
    for (const move of moves) {
      if (!next.freeItems.some((item) => item.id === move.itemId)) continue;
      next = updateFreeItem(next, { itemId: move.itemId, x: move.x, y: move.y }).doc;
    }
    return { doc: next };
  }, opts);
}

/**
 * 方向键微调。单个沿用「一按一条」；两个及以上在 800ms 内合并成一条撤销。
 */
export function nudgeFreeItems(store: CanvasStore, itemIds: readonly string[], dx: number, dy: number): void {
  const state = store.getState();
  const moves = itemIds.flatMap((itemId) => {
    const item = state.doc.freeItems.find((entry) => entry.id === itemId);
    return item ? [{ itemId, x: item.x + dx, y: item.y + dy }] : [];
  });
  if (moves.length === 0) return;
  if (itemIds.length === 1) {
    state.apply("移动自由容器", (doc) => updateFreeItem(doc, moves[0]));
    return;
  }
  applyMoveFreeItems(store, moves, {
    coalesceKey: `nudge-frees:${[...itemIds].slice().sort().join(",")}`,
  });
}

export function nudgeFreeItem(store: CanvasStore, itemId: string, dx: number, dy: number): void {
  nudgeFreeItems(store, [itemId], dx, dy);
}

/** 一次 apply 删除若干自由元素。 */
export function applyDeleteFreeItems(store: CanvasStore, itemIds: readonly string[]): void {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return;
  store.getState().apply(ids.length > 1 ? "删除多个自由容器" : "删除自由容器", (doc) => {
    let next = doc;
    for (const itemId of ids) {
      if (!next.freeItems.some((item) => item.id === itemId)) continue;
      next = deleteFreeItem(next, { itemId }).doc;
    }
    return { doc: next };
  });
}
