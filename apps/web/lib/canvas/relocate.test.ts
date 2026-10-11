import { describe, expect, it } from "vitest";
import { applySmartWeights, attachFreeItemToRegion, createBoard, createFreeText, insertColumn, relocateBlocks, setSectionWidthMode } from "./commands";
import { manualWeightsFromDrag } from "./layout";
import { emptyDoc, findBlockLocation } from "./model";
import { validateCanvasContent } from "./validation";
function fixture() {
  let n = 0;
  const ids = () => `block-${++n}`;
  let doc = createBoard(emptyDoc(), { x: 0, y: 0 }, ids).doc;
  const board = doc.boards[0], section = board.regions[0].sections[1];
  doc = insertColumn(doc, { boardId: board.id, sectionId: section.id, columnId: section.columns[0].id, side: "right" }, ids).doc;
  return { doc, ids, section: doc.boards[0].regions[0].sections[1] };
}
describe("module relocation transactions", () => {
  it("narrow columns remain positive and keep the same total width when dragging", () => {
    const result = manualWeightsFromDrag([50, 60], 0, 400);
    expect(result.every((w) => w > 0)).toBe(true);
    expect(result.reduce((a, b) => a + b, 0)).toBe(110);
  });
  it("moves multiple modules in document order and preserves the input/history snapshot", () => {
    const { doc, section } = fixture();
    const blocks = section.columns.map((c) => c.blocks[0]);
    const before = structuredClone(doc);
    const moved = relocateBlocks(doc, { blockIds: blocks.map((b) => b.id).reverse(), target: { columnId: section.columns[1].id } }).doc;
    expect(doc).toEqual(before);
    expect(findBlockLocation(moved, blocks[0].id)?.column.id).toBe(section.columns[1].id);
    expect(findBlockLocation(moved, blocks[1].id)?.column.blocks).toEqual(blocks);
    expect(validateCanvasContent(moved).errors).toEqual([]);
  });
  it("supports insertion before another module, including cross-row moves", () => {
    const { doc, section } = fixture();
    const title = doc.boards[0].regions[0].sections[0].columns[0].blocks[0];
    const target = section.columns[0];
    const moved = relocateBlocks(doc, { blockIds: [title.id], target: { columnId: target.id, beforeBlockId: target.blocks[0].id } }).doc;
    expect(findBlockLocation(moved, title.id)?.blockIndex).toBe(0);
    expect(validateCanvasContent(moved).errors).toEqual([]);
  });
  it("detaches text as a free item without changing its ID or content", () => {
    const { doc, section, ids } = fixture();
    const block = section.columns[0].blocks[0];
    const moved = relocateBlocks(doc, { blockIds: [block.id], freePositions: [{ blockId: block.id, x: 800, y: 60, width: 200 }] }, ids).doc;
    expect(moved.freeItems[0].block).toEqual(block);
    expect(findBlockLocation(moved, block.id)).toBeNull();
    expect(validateCanvasContent(moved).errors).toEqual([]);
  });
  it("rejects stale destinations and missing geometry without losing modules", () => {
    const { doc, section } = fixture();
    const block = section.columns[0].blocks[0];
    expect(relocateBlocks(doc, { blockIds: [block.id], target: { columnId: "missing" } }).doc).toBe(doc);
    expect(relocateBlocks(doc, { blockIds: [block.id], freePositions: [] }).doc).toBe(doc);
  });
  it("invalid free-to-region destination retains the source free item", () => {
    const { doc, ids } = fixture();
    const withFree = createFreeText(doc, { x: 800, y: 0 }, ids).doc;
    const result = attachFreeItemToRegion(withFree, { freeItemId: withFree.freeItems[0].id, boardId: withFree.boards[0].id,
      regionId: withFree.boards[0].regions[0].id, sectionId: "missing", columnId: "missing" }).doc;
    expect(result.freeItems).toEqual(withFree.freeItems);
    expect(validateCanvasContent(result).errors).toEqual([]);
  });
  it("background smart updates cannot override an explicit equal-width choice", () => {
    const { doc, section } = fixture();
    const equal = setSectionWidthMode(doc, { boardId: doc.boards[0].id, sectionId: section.id, mode: "equal" }).doc;
    const result = applySmartWeights(equal, { boardId: doc.boards[0].id, sectionId: section.id, weights: [2, 1] }).doc;
    expect(result.boards[0].regions[0].sections[1].widthMode).toBe("equal");
    expect(result.boards[0].regions[0].sections[1].columnWeights).toEqual([1, 1]);
  });
});
