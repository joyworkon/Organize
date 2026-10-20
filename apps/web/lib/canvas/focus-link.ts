import { findBlockLocation, type CanvasDoc } from "./model";
import type { InsertSelection } from "./insert-target";

export function selectionForFocus(doc: CanvasDoc, blockId: string): InsertSelection {
  if (findBlockLocation(doc, blockId)) return { kind: "block", blockId };
  const item = doc.freeItems.find((item) => item.block.id === blockId);
  return item ? { kind: "free", itemId: item.id } : null;
}

/** Remove only the one-shot focus parameter; retain other query params and the hash. */
export function withoutCanvasFocus(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("focus");
  return `${url.pathname}${url.search}${url.hash}`;
}
