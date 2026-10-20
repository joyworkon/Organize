import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFreeText, updateFreeItemBlock } from "@/lib/canvas/commands";
import {
  plainTextPasteIndex,
  readCanvasClipboard,
  resetCanvasClipboardMemory,
} from "@/lib/canvas/clipboard";
import { emptyDoc } from "@/lib/canvas/model";
import { CANVAS_LIMITS } from "@/lib/canvas/validation";
import { useToastStore } from "@/hooks/use-toast";
import { createCanvasStore } from "./canvas-store";
import {
  applyDeleteCanvasSelection,
  commitCanvasCopy,
  commitCanvasCut,
  commitCanvasPaste,
} from "./canvas-clipboard-actions";

beforeEach(() => {
  resetCanvasClipboardMemory();
});

afterEach(() => {
  for (const item of useToastStore.getState().toasts) useToastStore.getState().removeToast(item.id);
});

function freeStore(text = "原文") {
  let doc = createFreeText(emptyDoc(), { x: 100, y: 40 }).doc;
  const itemId = doc.freeItems[0].id;
  doc = updateFreeItemBlock(doc, { itemId, text }).doc;
  const store = createCanvasStore({ doc });
  store.getState().select({ kind: "free", itemId });
  return store;
}

describe("canvas clipboard actions", () => {
  it("pastes and cuts in one undo step", () => {
    const store = freeStore();
    const before = store.getState().doc;
    expect(commitCanvasCopy(store)).toBe(true);
    commitCanvasPaste(store, { pointer: { x: 5, y: 6 }, explicit: null, systemText: "原文" });
    expect(store.getState().doc.freeItems).toHaveLength(2);
    expect(store.getState().doc.freeItems[1]).toMatchObject({ x: 5, y: 6 });
    expect(store.getState().selection).toMatchObject({ kind: "free" });
    expect(store.getState().history.canUndo).toBe(true);
    expect(store.getState().history.peekUndoLabel()).toBe("粘贴自由元素");
    store.getState().undo();
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history.canUndo).toBe(false);

    store.getState().select({ kind: "free", itemId: before.freeItems[0].id });
    commitCanvasCut(store);
    expect(store.getState().doc.freeItems).toHaveLength(0);
    expect(store.getState().history.peekUndoLabel()).toBe("剪切自由元素");
    expect(store.getState().history.canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history.canUndo).toBe(false);
  });

  it("offsets each successful paste and keeps external text when the internal clipboard expired", () => {
    const store = freeStore("原文");
    commitCanvasCopy(store);
    const memory = readCanvasClipboard();
    if (!memory) throw new Error("memory");
    memory.systemConfirmed = true;
    commitCanvasPaste(store, { pointer: { x: 1, y: 2 }, explicit: null, systemText: "" });
    commitCanvasPaste(store, { pointer: { x: 1, y: 2 }, explicit: null, systemText: "" });
    const copies = store.getState().doc.freeItems.slice(1);
    expect(copies.map((item) => [item.x, item.y])).toEqual([[1, 2], [25, 26]]);

    const expired = freeStore("原文");
    commitCanvasCopy(expired);
    readCanvasClipboard()!.systemConfirmed = true;
    commitCanvasPaste(expired, { pointer: { x: 8, y: 9 }, explicit: null, systemText: "外部文字" });
    expect(expired.getState().doc.freeItems).toHaveLength(2);
    expect(expired.getState().doc.freeItems[1].block).toMatchObject({ type: "text", text: "外部文字" });
    expect(plainTextPasteIndex("外部文字")).toBe(1);
  });

  it("toasts and leaves the document when the paste would pass a limit", () => {
    const seed = createFreeText(emptyDoc(), { x: 0, y: 0 }).doc.freeItems[0];
    const doc = {
      ...emptyDoc(),
      freeItems: Array.from({ length: CANVAS_LIMITS.maxFreeItems }, (_, index) => ({
        ...structuredClone(seed),
        id: `f${index}`,
        x: index,
        zIndex: index + 1,
        block: { ...seed.block, id: `b${index}`, text: "满" },
      })),
    };
    const store = createCanvasStore({ doc });
    store.getState().select({ kind: "free", itemId: "f0" });
    commitCanvasCopy(store);
    const before = store.getState().doc;
    commitCanvasPaste(store, { pointer: { x: 1, y: 1 }, explicit: null, systemText: "" });
    expect(store.getState().doc).toBe(before);
    expect(store.getState().localSeq).toBe(0);
    expect(readCanvasClipboard()?.pasteCount).toBe(0);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      title: "无法粘贴",
      description: `自由元素已达 ${CANVAS_LIMITS.maxFreeItems} 个上限，这次没有粘贴`,
    });
  });

  it("copies in read-only and preview, and ignores cut and paste", () => {
    const readonly = freeStore();
    const doc = readonly.getState().doc;
    readonly.setState({ readOnly: true });
    expect(commitCanvasCopy(readonly)).toBe(true);
    expect(readCanvasClipboard()?.payload.kind).toBe("free");
    commitCanvasCut(readonly);
    commitCanvasPaste(readonly, { pointer: { x: 1, y: 1 }, explicit: null, systemText: "" });
    expect(readonly.getState().doc).toBe(doc);
    expect(readonly.getState().localSeq).toBe(0);

    resetCanvasClipboardMemory();
    const preview = freeStore();
    const previewDoc = preview.getState().doc;
    preview.getState().togglePreview();
    preview.getState().select({ kind: "free", itemId: previewDoc.freeItems[0].id });
    commitCanvasCut(preview);
    expect(hasNoClipboard());
    expect(commitCanvasCopy(preview)).toBe(true);
    commitCanvasPaste(preview, { pointer: { x: 1, y: 1 }, explicit: null, systemText: "" });
    expect(preview.getState().doc).toBe(previewDoc);
  });

  it("keeps the existing delete labels and uses 剪切 for a cut", () => {
    const store = freeStore();
    applyDeleteCanvasSelection(store);
    expect(store.getState().history.peekUndoLabel()).toBe("删除自由容器");
    store.getState().undo();
    const itemId = store.getState().doc.freeItems[0].id;
    const again = createFreeText(store.getState().doc, { x: 40, y: 40 }).doc;
    const store2 = createCanvasStore({ doc: again });
    store2.getState().select({ kind: "frees", itemIds: [itemId, again.freeItems[1].id] });
    applyDeleteCanvasSelection(store2, "剪切");
    expect(store2.getState().history.peekUndoLabel()).toBe("剪切多个自由元素");
    store2.getState().undo();
    store2.getState().select({ kind: "frees", itemIds: [itemId, again.freeItems[1].id] });
    applyDeleteCanvasSelection(store2);
    expect(store2.getState().history.peekUndoLabel()).toBe("删除多个自由容器");
  });
});

function hasNoClipboard(): boolean {
  return readCanvasClipboard() === null;
}
