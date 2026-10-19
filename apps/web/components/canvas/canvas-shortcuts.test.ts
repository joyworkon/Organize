// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBoard, createFreeText, insertBlockBelow } from "@/lib/canvas/commands";
import { emptyDoc, findBlockLocation } from "@/lib/canvas/model";
import { createCanvasStore } from "./canvas-store";
import { allCanvasBlockIds, canvasShortcutLabels, duplicateCanvasSelection, matchCanvasShortcut, zoomCanvasAtCenter } from "./canvas-shortcuts";

describe("canvas shortcut matching", () => {
  for (const mod of ["metaKey", "ctrlKey"]) {
    it.each([
      ["a", "select-all"], ["A", "select-all"], ["d", "duplicate"],
      ["=", "zoom-in"], ["+", "zoom-in"], ["-", "zoom-out"], ["0", "zoom-reset"],
    ])(`matches ${mod} + %s`, (key, action) => {
      expect(matchCanvasShortcut(new KeyboardEvent("keydown", { key, [mod]: true }))).toBe(action);
    });
  }
  it("matches Shift+=, Shift+1 and help across key representations", () => {
    const cases: [KeyboardEventInit, string][] = [
      [{ key: "+", shiftKey: true, metaKey: true }, "zoom-in"],
      [{ key: "!", code: "Digit1", shiftKey: true }, "zoom-fit"],
      [{ key: "1", shiftKey: true }, "zoom-fit"],
      [{ key: "?", shiftKey: true }, "help"],
      [{ key: "/", code: "Slash", shiftKey: true }, "help"],
    ];
    for (const [init, action] of cases) expect(matchCanvasShortcut(new KeyboardEvent("keydown", init))).toBe(action);
  });
  it("does not match unrelated, altered or already consumed keys", () => {
    for (const init of [
      { key: "a" }, { key: "/" }, { key: "1" }, { key: "d", ctrlKey: true, shiftKey: true },
      { key: "=", ctrlKey: true, altKey: true }, { key: "?", metaKey: true },
    ]) expect(matchCanvasShortcut(new KeyboardEvent("keydown", init))).toBeNull();
    const event = new KeyboardEvent("keydown", { key: "a", metaKey: true, cancelable: true });
    event.preventDefault();
    expect(matchCanvasShortcut(event)).toBeNull();
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])("ignores IME %j", (ime) => {
    for (const init of [{ key: "a", metaKey: true }, { key: "?" }, { key: "!", shiftKey: true }]) {
      expect(matchCanvasShortcut(new KeyboardEvent("keydown", { ...init, ...ime }))).toBeNull();
    }
  });
  it.each(["input", "textarea", "select", "div"])("leaves %s editing native", (tag) => {
    const target = document.createElement(tag);
    if (tag === "div") Object.defineProperty(target, "isContentEditable", { value: true });
    for (const key of ["a", "d", "=", "-", "0", "?"]) {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: key !== "?", bubbles: true });
      target.dispatchEvent(event);
      expect(matchCanvasShortcut(event)).toBeNull();
    }
  });
  it("labels platforms without requiring navigator during SSR", () => {
    expect(canvasShortcutLabels()).toEqual({ mod: "Ctrl+", shift: "Shift+" });
    expect(canvasShortcutLabels("MacIntel")).toEqual({ mod: "⌘", shift: "⇧" });
    for (const platform of ["Win32", "Linux x86_64"]) expect(canvasShortcutLabels(platform).mod).toBe("Ctrl+");
  });
});

describe("zoom around visible center", () => {
  it.each([0.01, 0.5, 1, 1.2, 8])("preserves the center world point at zoom %s", (nextZoom) => {
    const before = { x: -210, y: 85, zoom: 0.75 };
    const rect = { x: 280, y: 40, width: 650, height: 620 };
    const after = zoomCanvasAtCenter(before, nextZoom, rect);
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    expect((center.x - after.x) / after.zoom).toBeCloseTo((center.x - before.x) / before.zoom);
    expect((center.y - after.y) / after.zoom).toBeCloseTo((center.y - before.y) / before.zoom);
    expect(after.zoom).toBe(Math.min(4, Math.max(0.1, nextZoom)));
    expect(before).toEqual({ x: -210, y: 85, zoom: 0.75 });
  });
});

function fixture() {
  let doc = createBoard(emptyDoc(), { x: 0, y: 0 }).doc;
  const first = allCanvasBlockIds(doc)[0];
  doc = insertBlockBelow(doc, { blockId: first }).doc;
  doc = createBoard(doc, { x: 1000, y: 0 }).doc;
  return createFreeText(doc, { x: 2000, y: 0 }).doc;
}

describe("canvas selection commands", () => {
  it("selects board modules across boards without including free items, including readonly", () => {
    const doc = fixture();
    const ids = allCanvasBlockIds(doc);
    expect(ids).toHaveLength(5);
    expect(new Set(ids.map((id) => findBlockLocation(doc, id)!.board.id)).size).toBe(2);
    const store = createCanvasStore({ doc, readOnly: true });
    store.getState().select({ kind: "blocks", blockIds: ids });
    expect(store.getState().selection).toEqual({ kind: "blocks", blockIds: ids });
    expect(store.getState().localSeq).toBe(0);
    expect(allCanvasBlockIds(emptyDoc())).toEqual([]);
  });
  it("duplicates multiple blocks as one undo transaction and preserves content", () => {
    const doc = fixture();
    const ids = allCanvasBlockIds(doc);
    const store = createCanvasStore({ doc });
    const result = duplicateCanvasSelection(doc, { kind: "blocks", blockIds: ids });
    store.getState().apply("复制多个模块", () => result);
    store.getState().select({ kind: "blocks", blockIds: result.blockIds! });
    expect(result.blockIds).toHaveLength(ids.length);
    expect(allCanvasBlockIds(store.getState().doc)).toHaveLength(ids.length * 2);
    expect(store.getState().editingBlockId).toBeNull();
    for (let i = 0; i < ids.length; i++) {
      const original = findBlockLocation(doc, ids[i])!.block;
      expect(findBlockLocation(result.doc, result.blockIds![i])!.block).toEqual({ ...original, id: result.blockIds![i] });
    }
    expect(allCanvasBlockIds(doc)).toEqual(ids);
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc);
    expect(store.getState().history.canUndo).toBe(false);
    store.getState().redo();
    expect(allCanvasBlockIds(store.getState().doc)).toHaveLength(ids.length * 2);
  });
  it("duplicates a single block or region and leaves unsupported selections unchanged", () => {
    const doc = fixture();
    const blockId = allCanvasBlockIds(doc)[0];
    const single = duplicateCanvasSelection(doc, { kind: "block", blockId });
    expect(single.focus).toMatchObject({ kind: "block", edit: false, blockId: single.blockIds![0] });
    const board = doc.boards[0];
    const region = duplicateCanvasSelection(doc, { kind: "region", boardId: board.id, regionId: board.regions[0].id });
    expect(region.doc.boards[0].regions).toHaveLength(board.regions.length + 1);
    expect(region.focus?.kind).toBe("region");
    for (const selection of [null, { kind: "board" as const, boardId: board.id }, { kind: "free" as const, itemId: doc.freeItems[0].id }, { kind: "block" as const, blockId: "missing" }]) {
      expect(duplicateCanvasSelection(doc, selection).doc).toBe(doc);
    }
  });
});
