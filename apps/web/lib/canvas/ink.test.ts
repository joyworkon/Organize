import { describe, expect, it } from "vitest";
import { appendInkPoint, inkPath, normalizeInk, simplifyInk } from "./ink";
import { createFreeInk, createBoard, attachFreeItemToRegion, duplicateFreeItem, updateFreeItem, updateFreeItemBlock } from "./commands";
import { emptyDoc, INK_MAX_POINTS } from "./model";
import { validateCanvasContent } from "./validation";
import { computeScene, freeItemHeight } from "./layout";
import { copyCanvasSelection, pasteCanvasClipboard } from "./clipboard";
import { summarizeCanvas } from "./list-summary";
import { setFreeItemsLocked } from "./free-lock";
import { scaleFreeGroup } from "./free-resize";

const stroke = { x: 10, y: 20, width: 100, height: 60, points: [0, 0, 50, 60, 100, 0] };
const make = () => createFreeInk(emptyDoc(), stroke).doc;

describe("ink geometry", () => {
  it("ignores clicks, invalid coordinates, tiny boxes and oversized strokes; retains straight strokes", () => {
    for (const points of [[], [{ x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: NaN, y: 0 }, { x: 8, y: 0 }], [{ x: 0, y: 0 }, { x: 2001, y: 0 }]]) expect(normalizeInk(points)).toBeNull();
    expect(normalizeInk([{ x: -20, y: 30 }, { x: -20, y: 90 }])).toEqual({ x: -20, y: 30, width: 1, height: 60, points: [0, 0, 0, 60] });
  });
  it("simplifies straight samples while preserving corners, endpoints and input", () => {
    const points = [{ x: 10, y: 20 }, { x: 20, y: 20.1 }, { x: 30, y: 20 }, { x: 30, y: 40 }];
    expect(simplifyInk(points)).toEqual([points[0], points[2], points[3]]);
    expect(normalizeInk(points)).toEqual({ x: 10, y: 20, width: 20, height: 20, points: [0, 0, 20, 0, 20, 20] });
    expect(points[0]).toEqual({ x: 10, y: 20 });
    expect(inkPath([0, 0, 10, 20, 30, 0])).toBe("M 0 0 Q 10 20 20 10 L 30 0");
    expect(inkPath([0, 0, 30, 0])).toBe("M 0 0 L 30 0");
  });
  it("bounds live and saved point counts, retaining the final endpoint", () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({ x: i / 4, y: i % 2 ? 100 : 0 }));
    let live: typeof points = [];
    for (const point of points) live = appendInkPoint(live, point);
    expect(live.length).toBeLessThanOrEqual(INK_MAX_POINTS);
    expect(live.at(-1)).toEqual(points.at(-1));
    expect(normalizeInk(points)!.points.length).toBeLessThanOrEqual(INK_MAX_POINTS * 2);
  });
});

describe("ink document contract", () => {
  it("validates schema 2 and old documents, uses exact no-chrome height and summary geometry", () => {
    const doc = make();
    expect(validateCanvasContent(doc).ok).toBe(true);
    expect(validateCanvasContent(emptyDoc()).ok).toBe(true);
    expect(doc.schemaVersion).toBe(2);
    expect(freeItemHeight(doc.freeItems[0], () => { throw Error("ink must not measure text"); })).toBe(60);
    expect(computeScene(doc, () => 24).freeItems[0]).toMatchObject({ x: 10, y: 20, width: 100, height: 60 });
    expect(summarizeCanvas(doc)).toMatchObject({ blocks: 1, excerpt: "", shapes: [{ kind: "block" }] });
  });
  it.each([
    { points: [0, 0, 1] }, { points: [0, 0] }, { points: [0, 0, Infinity, 2] },
    { points: [0, 0, -1, 2] }, { points: [0, 0, 101, 2] }, { points: Array(2002).fill(0) },
    { strokeWidth: 3 }, { strokeWidth: "4" }, { color: "url(x)" }, { baseWidth: 0 },
    { baseHeight: NaN }, { height: 2001 },
  ])("rejects malformed ink %j", (patch) => {
    const doc = make(); Object.assign(doc.freeItems[0].block, patch);
    expect(validateCanvasContent(doc).ok).toBe(false);
  });
  it("rejects ink in page columns and never moves it into a region", () => {
    const doc = createBoard(make(), { x: 0, y: 0 }).doc;
    const board = doc.boards[0], region = board.regions[0];
    const result = attachFreeItemToRegion(doc, { freeItemId: doc.freeItems[0].id, boardId: board.id, regionId: region.id });
    expect(result.doc.freeItems).toEqual(doc.freeItems);
    const raw = JSON.parse(JSON.stringify(doc));
    raw.boards[0].regions[0].sections[0].columns[0].blocks = [{ ...doc.freeItems[0].block, id: "bad-ink" }];
    expect(validateCanvasContent(raw).errors.join()).toContain("笔迹仅允许自由定位");
  });
  it("resizes without rewriting points, copies independently, and respects geometry locks", () => {
    let doc = make(); const item = doc.freeItems[0];
    doc = updateFreeItem(doc, { itemId: item.id, width: 30, height: 120 }).doc;
    expect(doc.freeItems[0]).toMatchObject({ width: 30, block: { height: 120, baseWidth: 100, baseHeight: 60, points: stroke.points } });
    doc = updateFreeItemBlock(doc, { itemId: item.id, strokeWidth: 8, color: "blue" }).doc;
    const copy = duplicateFreeItem(doc, { itemId: item.id }).doc.freeItems[1];
    expect(copy.block).toMatchObject({ strokeWidth: 8, color: "blue", points: stroke.points });
    expect(copy.block).not.toBe(doc.freeItems[0].block);
    const payload = copyCanvasSelection(doc, { kind: "free", itemId: item.id })!;
    const pasted = pasteCanvasClipboard(doc, payload, { pointer: null, pasteIndex: 0, selection: null, explicit: null });
    expect(validateCanvasContent(pasted.doc).ok).toBe(true);
    expect(pasted.doc.freeItems[1].block).toMatchObject({ points: stroke.points });
    doc = setFreeItemsLocked(doc, { itemIds: [item.id], locked: true }).doc;
    expect(updateFreeItem(doc, { itemId: item.id, width: 400, height: 400 }).doc).toBe(doc);
    const scaled = scaleFreeGroup([{ id: item.id, x: 0, y: 0, width: 10, height: 20, minWidth: 1 }, { id: "other", x: 20, y: 0, width: 100, height: 20 }], "e", 12, 0, { snapEnabled: false });
    expect(scaled.members[0].width).toBeCloseTo(11);
  });
});
