import { expect, it } from "vitest";
import { appendMaterialCardToRegion, createBoard } from "./commands";
import { emptyDoc, type CanvasSourceRef } from "./model";
import { hasMaterialCard } from "./material-feedback";
const sourceRef: CanvasSourceRef = { kind: "memo", id: "memo", title: "Title", updatedAt: "2026-10-20" };
it("detects the same kind/id across pages, without matching title or a different source kind", () => {
  let doc = createBoard(emptyDoc(), { x: 0, y: 0 }).doc;
  doc = createBoard(doc, { x: 1000, y: 0 }).doc;
  doc = appendMaterialCardToRegion(doc, { boardId: doc.boards[1].id, title: "Title", text: "", sourceRef }).doc;
  expect(hasMaterialCard(doc, sourceRef)).toBe(true);
  expect(hasMaterialCard(doc, { ...sourceRef, kind: "reading" })).toBe(false);
  expect(hasMaterialCard(doc, { ...sourceRef, id: "other" })).toBe(false);
});
it("ignores excerpts and free text references, and tolerates missing snapshots", () => {
  const doc = createBoard(emptyDoc(), { x: 0, y: 0 }).doc;
  doc.boards[0].regions[0].sections[0].columns[0].blocks[0] = { id: "excerpt", type: "text", role: "body", text: "", sourceRef };
  expect(hasMaterialCard(doc, sourceRef)).toBe(false);
  doc.freeItems.push({ id: "free", x: 0, y: 0, width: 300, zIndex: 1, block: { id: "free-text", type: "text", role: "body", text: "", sourceRef } });
  expect(hasMaterialCard(doc, sourceRef)).toBe(false);
  expect(hasMaterialCard(null, sourceRef)).toBe(false);
});
