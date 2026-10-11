import type { CanvasBoard, CanvasDoc } from "./model";
import { CANVAS_SCHEMA_VERSION } from "./model";
import { insertBlockBelow, insertColumn, insertRegionAfter, insertSectionAfter } from "./commands";
import { computeScene, type CanvasMeasure } from "./layout";

export type CanvasInsertPreview =
  | { kind: "column-left"; sectionId: string; columnId: string }
  | { kind: "column-right"; sectionId: string; columnId: string }
  | { kind: "block-below"; blockId: string }
  | { kind: "section-band"; sectionId: string }
  | { kind: "region-band"; regionId: string };

/** 用真实插入命令和布局计算预览；仅临时文档，绝不改写原文档/历史。 */
export function computeInsertPreview(board: CanvasBoard, action: CanvasInsertPreview, measure: CanvasMeasure) {
  const doc: CanvasDoc = { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [board], freeItems: [] };
  let id = 0;
  const newId = () => `canvas-preview-${++id}`;
  const result = action.kind === "column-left" || action.kind === "column-right"
    ? insertColumn(doc, { boardId: board.id, sectionId: action.sectionId, columnId: action.columnId,
        side: action.kind === "column-left" ? "left" : "right" }, newId)
    : action.kind === "block-below"
      ? insertBlockBelow(doc, { blockId: action.blockId }, newId)
      : action.kind === "section-band"
        ? insertSectionAfter(doc, { boardId: board.id, sectionId: action.sectionId }, newId)
        : insertRegionAfter(doc, { boardId: board.id, regionId: action.regionId }, newId);
  if (result.focus?.kind !== "block") return null;
  const focus = result.focus;
  const sceneBoard = computeScene(result.doc, measure).boards[0];
  const region = sceneBoard.regions.find((r) => r.regionId === focus.regionId);
  const section = region?.sections.find((s) => s.sectionId === focus.sectionId);
  const column = section?.columns.find((c) => c.columnId === focus.columnId);
  if (action.kind === "region-band" && region) {
    return { x: board.x + board.padding, y: region.y,
      width: board.width - 2 * board.padding, height: region.height };
  }
  if ((action.kind === "column-left" || action.kind === "column-right") && column) {
    return { x: column.x, y: column.y, width: column.width, height: column.height };
  }
  return column?.blocks.find((b) => b.blockId === focus.blockId) ?? null;
}
