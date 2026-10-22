import { describe, expect, it } from "vitest";
import { createFreeText } from "@/lib/canvas/commands";
import { emptyDoc } from "@/lib/canvas/model";
import { setFreeItemsLocked } from "@/lib/canvas/free-lock";
import { applyAlignFreeItems, applyDistributeFreeItems, applyMoveFreeItems, nudgeFreeItems, toggleSelectedFreeItemsLocked } from "./free-item-actions";
import { createCanvasStore } from "./canvas-store";

function fixture() {
  let doc = emptyDoc();
  for (let n = 0; n < 3; n++) doc = createFreeText(doc, { x: n * 200, y: n * 100 }).doc;
  const ids = doc.freeItems.map((i) => i.id);
  doc = setFreeItemsLocked(doc, { itemIds: [ids[0]], locked: true }).doc;
  const store = createCanvasStore({ doc });
  store.getState().select({ kind: "frees", itemIds: ids });
  return { store, doc, ids };
}

describe("free lock actions", () => {
  it("locks mixed selection, unlocks an all-locked selection; each step undoes/redoes with the selection intact", () => {
    const { store, doc, ids } = fixture();
    const selection = store.getState().selection;
    toggleSelectedFreeItemsLocked(store);
    expect(store.getState().doc.freeItems.every((i) => i.locked)).toBe(true);
    expect(store.getState().selection).toEqual(selection);
    store.getState().undo();
    expect(store.getState().doc).toBe(doc);
    expect(store.getState().selection).toEqual(selection);
    store.getState().redo();
    toggleSelectedFreeItemsLocked(store);
    expect(store.getState().doc.freeItems.every((i) => i.locked === false)).toBe(true);
    store.getState().undo();
    expect(store.getState().doc.freeItems.every((i) => i.locked)).toBe(true);
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: ids });
  });

  it("rejects entire mixed move/nudge/align/distribution without adding history; unlocked selection still moves", () => {
    const { store, doc, ids } = fixture();
    nudgeFreeItems(store, [ids[0]], 1, 0);
    nudgeFreeItems(store, ids, 10, 0);
    applyMoveFreeItems(store, doc.freeItems.map((i) => ({ itemId: i.id, x: i.x + 10, y: i.y + 10 })));
    const boxes = ids.map((itemId) => ({ itemId, height: 50 }));
    applyAlignFreeItems(store, ids, boxes, "left");
    applyDistributeFreeItems(store, ids, boxes, "x");
    expect(store.getState().doc).toBe(doc);
    expect(store.getState().history.canUndo).toBe(false);
    nudgeFreeItems(store, [ids[1]], 10, 0);
    expect(store.getState().doc.freeItems[1].x).toBe(210);
  });

  it("does not toggle in read-only or preview, or with no free selection", () => {
    const { store, doc } = fixture();
    store.setState({ readOnly: true });
    toggleSelectedFreeItemsLocked(store);
    store.setState({ readOnly: false, previewMode: true });
    toggleSelectedFreeItemsLocked(store);
    store.setState({ previewMode: false, selection: null });
    toggleSelectedFreeItemsLocked(store);
    expect(store.getState().doc).toBe(doc);
    expect(store.getState().history.canUndo).toBe(false);
  });
});
