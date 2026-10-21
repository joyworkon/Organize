// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFreeSticky, createFreeText } from "@/lib/canvas/commands";
import { emptyDoc } from "@/lib/canvas/model";
import { CanvasPropertyBar } from "./canvas-property-bar";
import { createCanvasStore } from "./canvas-store";

describe("自由文本背景与便签事务", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("新建便签选中并编辑，一次撤销移除整张便签，重做恢复同一对象", () => {
    const store = createCanvasStore({ doc: emptyDoc() });
    store.getState().apply("新建便签", (doc) => createFreeSticky(doc, { x: 10, y: 20 }));
    const item = store.getState().doc.freeItems[0];
    expect(store.getState().selection).toEqual({ kind: "free", itemId: item.id });
    store.getState().startEdit(item.id);
    expect(store.getState().editingBlockId).toBe(item.id);
    store.getState().undo();
    expect(store.getState().doc.freeItems).toHaveLength(0);
    expect(store.getState().selection).toBeNull();
    expect(store.getState().editingBlockId).toBeNull();
    store.getState().redo();
    expect(store.getState().doc.freeItems).toEqual([item]);
    expect(store.getState().selection).toEqual({ kind: "free", itemId: item.id });
  });

  it.each([false, true])("普通自由文本/便签（%s）背景改色和清除可独立撤销，保留圆角和编辑对象", (sticky) => {
    const doc = (sticky ? createFreeSticky : createFreeText)(emptyDoc(), { x: 0, y: 0 }).doc;
    const item = doc.freeItems[0];
    const store = createCanvasStore({ doc });
    store.getState().startEdit(item.id);
    act(() => root.render(createElement(CanvasPropertyBar, { store, measurer: { measure: () => 60 } })));
    const pick = (color: string) => {
      const button = container.querySelector<HTMLButtonElement>(`[aria-label="背景：${color}"]`);
      expect(button).not.toBeNull();
      act(() => button!.click());
      expect(button!.getAttribute("aria-checked")).toBe("true");
    };
    pick("蓝");
    expect(store.getState().doc.freeItems[0].block.style?.background).toBe("blue");
    pick("绿");
    expect(store.getState().doc.freeItems[0].block.style?.background).toBe("green");
    pick("默认");
    expect(store.getState().doc.freeItems[0].block.style?.background).toBeNull();
    expect(store.getState().doc.freeItems[0].block.style?.radius).toBe(item.block.style?.radius);
    expect(store.getState().selection).toEqual({ kind: "free", itemId: item.id });
    expect(store.getState().editingBlockId).toBe(item.id);
    act(() => store.getState().undo());
    expect(store.getState().doc.freeItems[0].block.style?.background).toBe("green");
    act(() => store.getState().undo());
    expect(store.getState().doc.freeItems[0].block.style?.background).toBe("blue");
    act(() => store.getState().undo());
    expect(store.getState().doc).toEqual(doc);
  });
});
