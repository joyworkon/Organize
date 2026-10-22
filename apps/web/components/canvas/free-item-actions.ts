import { deleteFreeItem, updateFreeItem } from "@/lib/canvas/commands";
import {
  alignFreeItems,
  distributeFreeItems,
  type FreeAlignMode,
  type FreeArrangeMember,
  type FreeDistributeAxis,
} from "@/lib/canvas/free-align";
import { freeIdsFromSelection } from "@/lib/canvas/free-selection";
import { reorderFreeZIndexes, type FreeLayerAction } from "@/lib/canvas/free-layers";
import type { CanvasDoc } from "@/lib/canvas/model";
import { allFreeItemsLocked, hasLockedFreeItems, setFreeItemsLocked } from "@/lib/canvas/free-lock";
import type { CanvasStore } from "./canvas-store";

export const FREE_ARRANGE_ACTION_IDS = [
  "align-left",
  "align-center-x",
  "align-right",
  "align-top",
  "align-center-y",
  "align-bottom",
  "distribute-x",
  "distribute-y",
  "layer-front",
  "layer-forward",
  "layer-backward",
  "layer-back",
] as const;

export type FreeArrangeActionId = (typeof FREE_ARRANGE_ACTION_IDS)[number];

export function isFreeArrangeAction(value: string): value is FreeArrangeActionId {
  return (FREE_ARRANGE_ACTION_IDS as readonly string[]).includes(value);
}

export interface FreeArrangeBox {
  itemId: string;
  height: number;
}

/** 一次 apply 移动若干自由元素。不带回单个 free 焦点，避免多选塌缩。 */
export function applyMoveFreeItems(
  store: CanvasStore,
  moves: readonly { itemId: string; x: number; y: number }[],
  opts?: { coalesceKey?: string },
): void {
  if (moves.length === 0 || hasLockedFreeItems(store.getState().doc, moves.map((move) => move.itemId))) return;
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
  if (hasLockedFreeItems(state.doc, itemIds)) return;
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

const ALIGN_LABEL: Record<FreeAlignMode, string> = {
  left: "左对齐自由元素",
  "center-x": "水平居中自由元素",
  right: "右对齐自由元素",
  top: "顶对齐自由元素",
  "center-y": "垂直居中自由元素",
  bottom: "底对齐自由元素",
};

const LAYER_LABEL: Record<FreeLayerAction, string> = {
  front: "置于顶层",
  forward: "上移一层",
  backward: "下移一层",
  back: "置于底层",
};

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

/** 用文档里的 x/y/宽和场景里已测的高拼对齐盒子。缺任何一项则整次放弃，避免用假高度对齐。 */
export function freeArrangeMembers(
  doc: CanvasDoc,
  ids: readonly string[],
  boxes: readonly FreeArrangeBox[],
): FreeArrangeMember[] | null {
  const heightOf = new Map(boxes.map((box) => [box.itemId, box.height]));
  const members: FreeArrangeMember[] = [];
  for (const id of uniqueIds(ids)) {
    const item = doc.freeItems.find((entry) => entry.id === id);
    const height = heightOf.get(id);
    if (!item || height == null || !Number.isFinite(height)) return null;
    members.push({ id: item.id, x: item.x, y: item.y, width: item.width, height });
  }
  return members;
}

function applyFreePatches(
  store: CanvasStore,
  label: string,
  patches: readonly { itemId: string; x?: number; y?: number; zIndex?: number }[],
): void {
  if (patches.length === 0) return;
  store.getState().apply(label, (doc) => {
    let next = doc;
    for (const patch of patches) {
      const current = next.freeItems.find((item) => item.id === patch.itemId);
      if (!current) continue;
      const sameX = patch.x === undefined || patch.x === current.x;
      const sameY = patch.y === undefined || patch.y === current.y;
      const sameZ = patch.zIndex === undefined || patch.zIndex === current.zIndex;
      if (sameX && sameY && sameZ) continue;
      next = updateFreeItem(next, patch).doc;
    }
    return { doc: next };
  });
}

export function applyAlignFreeItems(
  store: CanvasStore,
  ids: readonly string[],
  boxes: readonly FreeArrangeBox[],
  mode: FreeAlignMode,
): void {
  if (ids.length < 2 || hasLockedFreeItems(store.getState().doc, ids)) return;
  const members = freeArrangeMembers(store.getState().doc, ids, boxes);
  if (!members) return;
  applyFreePatches(store, ALIGN_LABEL[mode], alignFreeItems(members, mode));
}

export function applyDistributeFreeItems(
  store: CanvasStore,
  ids: readonly string[],
  boxes: readonly FreeArrangeBox[],
  axis: FreeDistributeAxis,
): void {
  if (ids.length < 3 || hasLockedFreeItems(store.getState().doc, ids)) return;
  const members = freeArrangeMembers(store.getState().doc, ids, boxes);
  if (!members) return;
  const label = axis === "x" ? "水平分布自由元素" : "垂直分布自由元素";
  applyFreePatches(store, label, distributeFreeItems(members, axis));
}

export function applyReorderFreeItems(store: CanvasStore, ids: readonly string[], action: FreeLayerAction): void {
  if (ids.length === 0) return;
  const doc = store.getState().doc;
  const patches = reorderFreeZIndexes(
    doc.freeItems.map((item) => ({ id: item.id, zIndex: item.zIndex })),
    uniqueIds(ids),
    action,
  );
  applyFreePatches(store, LAYER_LABEL[action], patches);
}

/** All locked → unlock; otherwise lock the whole selection. Read-only/preview never mutate. */
export function toggleSelectedFreeItemsLocked(store: CanvasStore): void {
  const state = store.getState();
  if (state.readOnly || state.previewMode) return;
  const itemIds = freeIdsFromSelection(state.selection);
  const locked = !allFreeItemsLocked(state.doc, itemIds);
  state.apply(locked ? "锁定自由元素" : "解锁自由元素", (doc) => setFreeItemsLocked(doc, { itemIds, locked }));
}

/** 属性栏、右键和角标共用。不带回 free 焦点，多选不会塌成单选。一次调用一条撤销。 */
export function applyArrangeAction(
  store: CanvasStore,
  action: FreeArrangeActionId,
  boxes: readonly FreeArrangeBox[],
  ids: readonly string[] = freeIdsFromSelection(store.getState().selection),
): void {
  switch (action) {
    case "align-left": return applyAlignFreeItems(store, ids, boxes, "left");
    case "align-center-x": return applyAlignFreeItems(store, ids, boxes, "center-x");
    case "align-right": return applyAlignFreeItems(store, ids, boxes, "right");
    case "align-top": return applyAlignFreeItems(store, ids, boxes, "top");
    case "align-center-y": return applyAlignFreeItems(store, ids, boxes, "center-y");
    case "align-bottom": return applyAlignFreeItems(store, ids, boxes, "bottom");
    case "distribute-x": return applyDistributeFreeItems(store, ids, boxes, "x");
    case "distribute-y": return applyDistributeFreeItems(store, ids, boxes, "y");
    case "layer-front": return applyReorderFreeItems(store, ids, "front");
    case "layer-forward": return applyReorderFreeItems(store, ids, "forward");
    case "layer-backward": return applyReorderFreeItems(store, ids, "backward");
    case "layer-back": return applyReorderFreeItems(store, ids, "back");
    default: {
      const neverAction: never = action;
      return neverAction;
    }
  }
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
