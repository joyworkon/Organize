import { expect, it } from "vitest";
import { createBoard, createFreeText } from "./commands";
import { emptyDoc } from "./model";
import { selectionForFocus, withoutCanvasFocus } from "./focus-link";
it("resolves a block on a distant page and a free block without modifying the document", () => {
  let doc = createBoard(emptyDoc(), { x: 9000, y: 8000 }).doc;
  doc = createFreeText(doc, { x: 20000, y: 30000 }).doc;
  const before = structuredClone(doc);
  const id = doc.boards[0].regions[0].sections[0].columns[0].blocks[0].id;
  expect(selectionForFocus(doc, id)).toEqual({ kind: "block", blockId: id });
  expect(selectionForFocus(doc, doc.freeItems[0].block.id)).toEqual({ kind: "free", itemId: doc.freeItems[0].id });
  expect(selectionForFocus(doc, "deleted")).toBeNull();
  expect(doc).toEqual(before);
});
it("consumes only focus, including missing blocks, preserving the route, other queries and hash", () => {
  expect(withoutCanvasFocus("https://example.com/canvas/id?view=preview&focus=deleted&other=1#part")).toBe("/canvas/id?view=preview&other=1#part");
  expect(withoutCanvasFocus("https://example.com/canvas/id?focus=b")).toBe("/canvas/id");
});
