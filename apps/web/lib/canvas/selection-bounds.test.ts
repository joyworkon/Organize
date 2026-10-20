import { describe, expect, it } from "vitest";
import { createBoard, createFreeText } from "./commands";
import { emptyDoc } from "./model";
import { computeScene } from "./layout";
import { boundsForSelection } from "./selection-bounds";

function fixture() {
  let doc = createBoard(emptyDoc(), { x: -500, y: -100 }).doc;
  doc = createBoard(doc, { x: 1200, y: 500 }).doc;
  doc = createFreeText(doc, { x: -800, y: 150, width: 180 }).doc;
  doc = createFreeText(doc, { x: 900, y: -200, width: 250 }).doc;
  const scene = computeScene(doc, (_block, width) => width / 2);
  return { doc, scene };
}

describe("boundsForSelection", () => {
  it("页面与区块框按真实 padding 几何，支持负坐标", () => {
    const { doc, scene } = fixture();
    const board = scene.boards[0];
    expect(boundsForSelection(scene, { kind: "board", boardId: board.boardId }, doc)).toMatchObject({ x: board.x, y: board.y, width: board.width, height: board.height });
    const region = board.regions[0];
    expect(boundsForSelection(scene, { kind: "region", boardId: board.boardId, regionId: region.regionId }, doc)).toEqual({
      x: board.x + doc.boards[0].padding, y: region.y, width: board.width - doc.boards[0].padding * 2, height: region.height,
    });
  });
  it("模块和跨页多选使用精确模块盒，不退回整页", () => {
    const { doc, scene } = fixture();
    const a = scene.boards[0].regions[0].sections[0].columns[0].blocks[0];
    const b = scene.boards[1].regions[0].sections[0].columns[0].blocks[0];
    expect(boundsForSelection(scene, { kind: "block", blockId: a.blockId }, doc)).toEqual({ x: a.x, y: a.y, width: a.width, height: a.height });
    expect(boundsForSelection(scene, { kind: "blocks", blockIds: [a.blockId, b.blockId, a.blockId] }, doc)).toEqual({ x: a.x, y: a.y, width: b.x + b.width - a.x, height: b.y + b.height - a.y });
  });
  it("自由元素单选/多选沿用测量高度", () => {
    const { doc, scene } = fixture();
    const [a, b] = scene.freeItems;
    expect(boundsForSelection(scene, { kind: "free", itemId: a.itemId }, doc)).toEqual({ x: a.x, y: a.y, width: a.width, height: a.height });
    expect(boundsForSelection(scene, { kind: "frees", itemIds: [a.itemId, b.itemId] }, doc)).toEqual({ x: a.x, y: b.y, width: b.x + b.width - a.x, height: a.y + a.height - b.y });
  });
  it("空选区、全部过期 ID 返回 null；部分失效 ID 忽略", () => {
    const { doc, scene } = fixture();
    for (const selection of [null, { kind: "board" as const, boardId: "gone" }, { kind: "blocks" as const, blockIds: [] }, { kind: "frees" as const, itemIds: ["gone"] }, { kind: "region" as const, boardId: "gone", regionId: doc.boards[0].regions[0].id }]) {
      expect(boundsForSelection(scene, selection, doc)).toBeNull();
    }
    const id = doc.freeItems[0].id;
    expect(boundsForSelection(scene, { kind: "frees", itemIds: [id, "gone"] }, doc)).toEqual(boundsForSelection(scene, { kind: "free", itemId: id }, doc));
  });
});
