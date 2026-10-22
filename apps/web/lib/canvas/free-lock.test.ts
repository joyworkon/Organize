import { describe, expect, it } from "vitest";
import { createBoard, createFreeImage, createFreeShape, createFreeText, attachFreeItemToRegion, deleteFreeItem, duplicateFreeItem, updateFreeItem, updateFreeItemBlock } from "./commands";
import { copyCanvasSelection, pasteCanvasClipboard } from "./clipboard";
import { allFreeItemsLocked, hasLockedFreeItems, setFreeItemsLocked } from "./free-lock";
import { emptyDoc, ensureCanvasDocV2 } from "./model";
import { validateCanvasContent } from "./validation";

function fixture() {
  let doc = createFreeText(emptyDoc(), { x: 20, y: 40 }).doc;
  doc = createFreeImage(doc, { x: 300, y: 60 }).doc;
  doc = createFreeShape(doc, { x: 600, y: 80, kind: "rect" }).doc;
  return doc;
}

describe("free item locking", () => {
  it("locks/unlocks a batch without mutation, skips invalid/duplicate ids and rejects an empty target", () => {
    const doc = fixture();
    const ids = doc.freeItems.map((i) => i.id);
    const result = setFreeItemsLocked(doc, { itemIds: [...ids, ids[0], "missing"], locked: true });
    expect(result.doc.freeItems.every((i) => i.locked === true)).toBe(true);
    expect(doc.freeItems.every((i) => i.locked === undefined)).toBe(true);
    expect(result.focus).toBeUndefined();
    expect(result.doc.schemaVersion).toBe(2);
    expect(setFreeItemsLocked(result.doc, { itemIds: ids, locked: true }).doc).toBe(result.doc);
    const unlocked = setFreeItemsLocked(result.doc, { itemIds: [ids[0]], locked: false }).doc;
    expect(unlocked.freeItems.map((i) => i.locked)).toEqual([false, true, true]);
    expect(hasLockedFreeItems(unlocked, ids)).toBe(true);
    expect(allFreeItemsLocked(unlocked, ids)).toBe(false);
    expect(allFreeItemsLocked(unlocked, ["missing"])).toBe(false);
    for (const itemIds of [[], ["missing"]]) {
      expect(setFreeItemsLocked(doc, { itemIds, locked: true })).toEqual({ doc, rejected: "未找到自由元素" });
    }
  });

  it("blocks geometry and attachment, while allowing styles, layers and deletion", () => {
    const base = createBoard(fixture(), { x: 0, y: 0 }).doc;
    const doc = setFreeItemsLocked(base, { itemIds: base.freeItems.map((i) => i.id), locked: true }).doc;
    for (const item of doc.freeItems) {
      expect(updateFreeItem(doc, { itemId: item.id, x: 1000, y: 1000, width: 500, height: 500 }).doc).toBe(doc);
      const layered = updateFreeItem(doc, { itemId: item.id, x: 1000, zIndex: 20 }).doc.freeItems.find((i) => i.id === item.id)!;
      expect(layered).toEqual({ ...item, zIndex: 20 });
      expect(deleteFreeItem(doc, { itemId: item.id }).doc.freeItems).toHaveLength(2);
      expect(attachFreeItemToRegion(doc, { freeItemId: item.id, boardId: doc.boards[0].id, regionId: doc.boards[0].regions[0].id }).doc).toBe(doc);
      const styled = updateFreeItemBlock(doc, { itemId: item.id, height: 500, text: "仍可编辑", style: { background: "green" } }).doc.freeItems.find((i) => i.id === item.id)!;
      expect(styled.block.style?.background).toBe("green");
      if (styled.block.type === "shape" && item.block.type === "shape") expect(styled.block.height).toBe(item.block.height);
      if (styled.block.type === "text") expect(styled.block.text).toBe("仍可编辑");
    }
    const itemId = doc.freeItems[0].id;
    const unlocked = setFreeItemsLocked(doc, { itemIds: [itemId], locked: false }).doc;
    expect(updateFreeItem(unlocked, { itemId, x: 123, width: 500 }).doc.freeItems[0]).toMatchObject({ x: 123, width: 500 });
    expect(attachFreeItemToRegion(unlocked, { freeItemId: itemId, boardId: doc.boards[0].id, regionId: doc.boards[0].regions[0].id }).doc.freeItems).toHaveLength(2);
  });

  it("preserves locks through duplicate, clipboard and serialized document reload", () => {
    const base = fixture();
    const doc = setFreeItemsLocked(base, { itemIds: base.freeItems.map((i) => i.id), locked: true }).doc;
    const reloaded = ensureCanvasDocV2(JSON.parse(JSON.stringify(doc)));
    expect(validateCanvasContent(reloaded).ok).toBe(true);
    expect(reloaded.freeItems.every((i) => i.locked)).toBe(true);
    for (const item of doc.freeItems) {
      const duplicated = duplicateFreeItem(doc, { itemId: item.id }).doc.freeItems.at(-1)!;
      expect(duplicated.locked).toBe(true);
      expect(duplicated.id).not.toBe(item.id);
      expect(duplicated.block.id).not.toBe(item.block.id);
    }
    const payload = copyCanvasSelection(doc, { kind: "frees", itemIds: doc.freeItems.map((i) => i.id) })!;
    const pasted = pasteCanvasClipboard(emptyDoc(), payload, { pointer: null, pasteIndex: 0, selection: null, explicit: null }).doc;
    expect(pasted.freeItems).toHaveLength(3);
    expect(pasted.freeItems.every((i) => i.locked)).toBe(true);
    expect(pasted.freeItems.map((i) => i.id).some((id) => doc.freeItems.some((i) => i.id === id))).toBe(false);
  });

  it.each([undefined, false, true])("accepts old documents and boolean lock %s", (locked) => {
    const doc = fixture();
    if (locked !== undefined) doc.freeItems[0].locked = locked;
    expect(validateCanvasContent(doc).ok).toBe(true);
  });

  it.each([null, "true", 0, 1, {}, []])("rejects invalid lock %j", (locked) => {
    const doc = fixture();
    const result = validateCanvasContent({ ...doc, freeItems: [{ ...doc.freeItems[0], locked }] });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("freeItems[0].locked 必须是 boolean");
  });
});
