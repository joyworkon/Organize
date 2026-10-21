import { describe, expect, it, vi } from "vitest";
import { attachFreeItemToRegion, createBoard, createFreeShape, deleteFreeItem, duplicateFreeItem, updateFreeItem, updateFreeItemBlock } from "./commands";
import { emptyDoc } from "./model";
import { BLOCK_CHROME, freeItemHeight } from "./layout";
import { validateCanvasContent, CANVAS_LIMITS } from "./validation";
import { copyCanvasSelection, pasteCanvasClipboard } from "./clipboard";
import { resizeFreeItem, SHAPE_RESIZE_HANDLES } from "./free-resize";
import { summarizeCanvas } from "./list-summary";

const make = () => createFreeShape(emptyDoc(), { x: 10, y: 20, kind: "rect" }).doc;

describe("自由形状合同", () => {
  it.each(["rect", "ellipse"] as const)("%s 默认蓝底、尺寸、选中不编辑；旧画布和新画布均可保存", (kind) => {
    const old = emptyDoc();
    const result = createFreeShape(old, { x: 10, y: 20, kind });
    const item = result.doc.freeItems[0];
    expect(old.freeItems).toEqual([]);
    expect(result.doc.schemaVersion).toBe(2);
    expect(item).toMatchObject({ x: 10, y: 20, width: 160, block: { type: "shape", kind, height: 100, style: { background: "blue", radius: 8 } } });
    expect(result.focus).toEqual({ kind: "free", itemId: item.id, edit: false });
    expect(validateCanvasContent(old).ok).toBe(true);
    expect(validateCanvasContent(result.doc).ok).toBe(true);
    const measure = vi.fn(() => 999);
    expect(freeItemHeight(item, measure)).toBe(100 + BLOCK_CHROME);
    expect(measure).not.toHaveBeenCalled();
    expect(summarizeCanvas(result.doc)).toMatchObject({ blocks: 1, excerpt: "", shapes: [{ kind: "block" }] });
  });

  it("种类/内容高度/背景可更新；几何高写回内容高；形状不可移入区块", () => {
    let doc = make();
    const id = doc.freeItems[0].id;
    doc = updateFreeItemBlock(doc, { itemId: id, kind: "ellipse", height: 130, style: { background: null } }).doc;
    expect(doc.freeItems[0].block).toMatchObject({ kind: "ellipse", height: 130, style: { background: null, radius: 8 } });
    doc = updateFreeItem(doc, { itemId: id, x: -50, y: 40, width: 200, height: 250 }).doc;
    expect(doc.freeItems[0]).toMatchObject({ x: -50, y: 40, width: 200, block: { height: 250 - BLOCK_CHROME } });
    const boardDoc = createBoard(doc, { x: 0, y: 0 }).doc;
    const board = boardDoc.boards[0];
    expect(attachFreeItemToRegion(boardDoc, { freeItemId: id, boardId: board.id, regionId: board.regions[0].id }).doc).toEqual(boardDoc);
  });

  it.each([undefined, null, "100", 0, -1, 23, 2001, Infinity, NaN])("非法高度 %s 被拒绝", (height) => {
    const doc = make();
    const raw = JSON.parse(JSON.stringify(doc));
    raw.freeItems[0].block.height = height;
    expect(validateCanvasContent(raw).errors).toContain("freeItems[0].block.height 非法");
  });

  it("未知形状、非法样式和版面内形状被拒绝", () => {
    const doc = make();
    const raw = JSON.parse(JSON.stringify(doc));
    raw.freeItems[0].block.kind = "triangle";
    raw.freeItems[0].block.style.radius = -1;
    expect(validateCanvasContent(raw).errors).toEqual(expect.arrayContaining(["freeItems[0].block.kind 非法", "freeItems[0].block.style.radius 非法"]));
    const board = createBoard(emptyDoc(), { x: 0, y: 0 }).doc;
    const invalid = JSON.parse(JSON.stringify(board));
    invalid.boards[0].regions[0].sections[0].columns[0].blocks[0] = doc.freeItems[0].block;
    expect(validateCanvasContent(invalid).errors.some((e) => e.includes("形状仅允许自由定位"))).toBe(true);
  });

  it("复制/粘贴/副本保留形状并重建 ID，删除级联连接线，上限拒绝创建", () => {
    const doc = createFreeShape(make(), { x: 210, y: 20, kind: "ellipse", height: 120 }).doc;
    const [a, b] = doc.freeItems;
    doc.connectors = [{ id: "edge", from: a.id, to: b.id, arrow: "end", line: "solid", color: "", label: "" }];
    const payload = copyCanvasSelection(doc, { kind: "frees", itemIds: [a.id, b.id] })!;
    const pasted = pasteCanvasClipboard(doc, payload, { pointer: null, pasteIndex: 0, selection: null, explicit: null }).doc;
    expect(pasted.freeItems.slice(2).map((item) => item.block)).toEqual([expect.objectContaining({ kind: "rect", height: 100 }), expect.objectContaining({ kind: "ellipse", height: 120 })]);
    expect(pasted.freeItems[2].block.id).not.toBe(a.block.id);
    expect(pasted.connectors![1]).toMatchObject({ from: pasted.freeItems[2].id, to: pasted.freeItems[3].id });
    expect(validateCanvasContent(pasted).ok).toBe(true);
    const duplicate = duplicateFreeItem(doc, { itemId: b.id }).doc.freeItems[2];
    expect(duplicate.block).toEqual({ ...b.block, id: duplicate.block.id });
    expect(deleteFreeItem(doc, { itemId: a.id }).doc.connectors).toEqual([]);
    const full = { ...doc, freeItems: Array(CANVAS_LIMITS.maxFreeItems).fill(a) };
    expect(createFreeShape(full, { x: 0, y: 0, kind: "rect" }).doc).toBe(full);
  });
});

describe("自由形状独立宽高缩放", () => {
  const origin = { x: 10, y: 20, width: 160, height: 126 };
  const opts = { independentHeight: true, snapEnabled: false };
  it.each(SHAPE_RESIZE_HANDLES)("%s 保持对侧锚点；边手柄只改对应轴", (handle) => {
    const next = resizeFreeItem(origin, handle, 30, 20, opts);
    expect(next.width).toBe(handle.includes("e") ? 190 : handle.includes("w") ? 130 : 160);
    expect(next.height).toBe(handle.includes("s") ? 146 : handle.includes("n") ? 106 : 126);
    expect(handle.includes("w") ? next.x + next.width : next.x).toBe(handle.includes("w") ? 170 : 10);
    expect(handle.includes("n") ? next.y + next.height : next.y).toBe(handle.includes("n") ? 146 : 20);
  });
  it("中心缩放、最小/最大尺寸、上下边吸附与取消吸附", () => {
    const centered = resizeFreeItem(origin, "nw", -30, -20, { ...opts, center: true });
    expect(centered).toMatchObject({ x: -20, y: 0, width: 220, height: 166 });
    expect(resizeFreeItem(origin, "nw", 9999, 9999, opts)).toMatchObject({ width: 80, height: 50 });
    expect(resizeFreeItem(origin, "se", 9999, 9999, opts)).toMatchObject({ width: 2000, height: 2026 });
    const snap = { independentHeight: true, threshold: 6, targets: [{ x: 300, y: 170, width: 100, height: 90 }] };
    expect(resizeFreeItem(origin, "s", 0, 20, snap)).toMatchObject({ height: 150, guides: [expect.objectContaining({ axis: "y", pos: 170 })] });
    expect(resizeFreeItem(origin, "s", 0, 20, { ...snap, snapEnabled: false })).toMatchObject({ height: 146, guides: [] });
  });
});
