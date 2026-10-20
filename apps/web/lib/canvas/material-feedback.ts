import type { CanvasDoc, CanvasSourceRef } from "./model";

export const MATERIAL_ADD_SUCCESS = "已添加到画布";
export const MATERIAL_ADD_ERROR = "添加到画布失败";

/** Only inspect the already loaded snapshot, including cards on other pages/free containers. */
export function hasMaterialCard(doc: CanvasDoc | null, source: Pick<CanvasSourceRef, "kind" | "id">): boolean {
  if (!doc) return false;
  const blocks = doc.boards.flatMap((board) => board.regions).flatMap((region) => region.sections)
    .flatMap((section) => section.columns).flatMap((column) => column.blocks);
  return [...blocks, ...doc.freeItems.map((item) => item.block)].some((block) =>
    block.type === "materialCard" && block.sourceRef.kind === source.kind && block.sourceRef.id === source.id,
  );
}
