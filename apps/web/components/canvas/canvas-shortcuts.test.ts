// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBoard, createFreeText, FREE_ITEM_DUPLICATE_OFFSET, insertBlockBelow } from "@/lib/canvas/commands";
import { emptyDoc, findBlockLocation } from "@/lib/canvas/model";
import { createCanvasStore } from "./canvas-store";
import { allCanvasBlockIds, canvasShortcutLabels, commitCanvasDuplicate, duplicateCanvasSelection, matchCanvasShortcut, zoomCanvasAtCenter } from "./canvas-shortcuts";

describe("canvas shortcut matching", () => {
  for (const mod of ["metaKey", "ctrlKey"]) {
    it.each([
      ["f", "find"], ["F", "find"], ["a", "select-all"], ["A", "select-all"], ["c", "copy"], ["C", "copy"],
      ["x", "cut"], ["X", "cut"], ["v", "paste"], ["V", "paste"], ["d", "duplicate"],
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
      [{ key: "@", code: "Digit2", shiftKey: true }, "zoom-selection"],
      [{ key: "2", shiftKey: true }, "zoom-selection"],
      [{ key: "?", shiftKey: true }, "help"],
      [{ key: "/", code: "Slash", shiftKey: true }, "help"],
    ];
    for (const [init, action] of cases) expect(matchCanvasShortcut(new KeyboardEvent("keydown", init))).toBe(action);
  });
  it("does not match unrelated, altered or already consumed keys", () => {
    for (const init of [
      { key: "a" }, { key: "/" }, { key: "1" }, { key: "d", ctrlKey: true, shiftKey: true },
      { key: "c", metaKey: true, shiftKey: true }, { key: "x", ctrlKey: true, shiftKey: true },
      { key: "v", metaKey: true, shiftKey: true }, { key: "c", ctrlKey: true, altKey: true },
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
    for (const key of ["f", "a", "c", "x", "v", "d", "=", "-", "0", "?"]) {
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
    for (const selection of [null, { kind: "block" as const, blockId: "missing" }]) {
      expect(duplicateCanvasSelection(doc, selection).doc).toBe(doc);
    }
    expect(duplicateCanvasSelection(doc, { kind: "board", boardId: board.id }).focus?.kind).toBe("board");
    const source = doc.freeItems[0];
    const free = duplicateCanvasSelection(doc, { kind: "free", itemId: source.id });
    expect(free.doc.freeItems).toHaveLength(doc.freeItems.length + 1);
    expect(free.focus).toMatchObject({ kind: "free", edit: false });
    const copy = free.doc.freeItems.find((item) => item.id === (free.focus?.kind === "free" ? free.focus.itemId : ""));
    expect(copy).toMatchObject({ x: source.x + FREE_ITEM_DUPLICATE_OFFSET, y: source.y + FREE_ITEM_DUPLICATE_OFFSET });
    expect(copy?.block.id).not.toBe(source.block.id);
    expect(copy?.id).not.toBe(source.id);
  });

  it("duplicates a free-item group as one undo and selects the copies", () => {
    let doc = createFreeText(emptyDoc(), { x: 10, y: 20 }).doc;
    doc = createFreeText(doc, { x: 400, y: 80 }).doc;
    const ids = doc.freeItems.map((item) => item.id);
    const store = createCanvasStore({ doc });
    store.getState().select({ kind: "frees", itemIds: ids });
    const before = store.getState().doc;
    commitCanvasDuplicate(store);
    const next = store.getState().doc;
    expect(next.freeItems).toHaveLength(4);
    const selection = store.getState().selection;
    expect(selection?.kind).toBe("frees");
    if (selection?.kind !== "frees") return;
    const copies = selection.itemIds.map((id) => next.freeItems.find((item) => item.id === id)!);
    expect(copies.map((item) => [item.x, item.y])).toEqual([
      [10 + FREE_ITEM_DUPLICATE_OFFSET, 20 + FREE_ITEM_DUPLICATE_OFFSET],
      [400 + FREE_ITEM_DUPLICATE_OFFSET, 80 + FREE_ITEM_DUPLICATE_OFFSET],
    ]);
    expect(new Set(copies.map((item) => item.block.id)).size).toBe(2);
    store.getState().undo();
    expect(store.getState().doc).toBe(before);
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: ids });
    expect(store.getState().history.canUndo).toBe(false);
    const locked = createCanvasStore({ doc: before, readOnly: true });
    locked.getState().select({ kind: "frees", itemIds: ids });
    commitCanvasDuplicate(locked);
    expect(locked.getState().doc).toBe(before);
  });
});
