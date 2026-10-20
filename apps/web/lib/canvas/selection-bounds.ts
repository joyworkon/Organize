import type { CanvasDoc } from "./model";
import type { InsertSelection } from "./insert-target";
import type { Scene } from "./layout";

export interface SelectionBounds { x: number; y: number; width: number; height: number }

/** 使用已测场景几何；缺失/空选区返回 null，不退回整张画布。 */
export function boundsForSelection(scene: Scene, selection: InsertSelection, doc?: CanvasDoc): SelectionBounds | null {
  if (!selection) return null;
  let boxes: SelectionBounds[];
  if (selection.kind === "board") {
    boxes = scene.boards.filter((b) => b.boardId === selection.boardId);
  } else if (selection.kind === "region") {
    const board = scene.boards.find((b) => b.boardId === selection.boardId);
    const region = board?.regions.find((r) => r.regionId === selection.regionId);
    const model = doc?.boards.find((b) => b.id === selection.boardId);
    if (!board || !region || !model) return null;
    boxes = [{ x: board.x + model.padding, y: region.y, width: board.width - model.padding * 2, height: region.height }];
  } else if (selection.kind === "free" || selection.kind === "frees") {
    const ids = new Set(selection.kind === "free" ? [selection.itemId] : selection.itemIds);
    boxes = scene.freeItems.filter((f) => ids.has(f.itemId));
  } else {
    const ids = new Set(selection.kind === "block" ? [selection.blockId] : selection.blockIds);
    boxes = scene.boards.flatMap((b) => b.regions).flatMap((r) => r.sections)
      .flatMap((s) => s.columns).flatMap((c) => c.blocks).filter((b) => ids.has(b.blockId));
  }
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}
