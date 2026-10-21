// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/hooks/use-toast";
import { createBoard } from "@/lib/canvas/commands";
import { computeScene } from "@/lib/canvas/layout";
import { createButtonBlock, createImageBlock, createTextBlock, emptyDoc, findBlockLocation } from "@/lib/canvas/model";
import { CANVAS_LIMITS } from "@/lib/canvas/validation";
import { canDetachSelection, commitDetachSelection } from "./canvas-detach-actions";
import { CanvasPropertyBar } from "./canvas-property-bar";
import { createCanvasStore } from "./canvas-store";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

function setup() {
  const doc = createBoard(emptyDoc(), { x: 180, y: -40 }).doc;
  const column = doc.boards[0].regions[0].sections[1].columns[0];
  column.blocks.push(createImageBlock({ url: "https://example.com/image.png", naturalWidth: 400, naturalHeight: 300 }));
  const store = createCanvasStore({ doc });
  const blockIds = column.blocks.map((b) => b.id);
  const scene = computeScene(doc, () => 92);
  return { store, blockIds, scene, doc };
}

describe("转为自由定位事务", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([false, true])("单选/多选（%s）一次撤销恢复内容、结构和选区，重做恢复自由选区", (multi) => {
    const { store, blockIds, scene, doc } = setup();
    const selection = multi ? { kind: "blocks" as const, blockIds } : { kind: "block" as const, blockId: blockIds[1] };
    store.getState().select(selection);
    expect(commitDetachSelection(store, scene)).toBe(true);
    expect(store.getState().localSeq).toBe(1);
    expect(store.getState().editingBlockId).toBeNull();
    const detached = store.getState().doc;
    const freeSelection = store.getState().selection;
    expect(freeSelection?.kind).toBe(multi ? "frees" : "free");
    expect(detached.freeItems).toHaveLength(multi ? 2 : 1);
    store.getState().undo();
    expect(store.getState().doc).toEqual(doc);
    expect(store.getState().selection).toEqual(selection);
    store.getState().redo();
    expect(store.getState().doc).toEqual(detached);
    expect(store.getState().selection).toEqual(freeSelection);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "已转为自由定位，可拖动调整" }));
  });

  it("混合类型整批拒绝，选区、历史和序号不动", () => {
    const { store, blockIds, doc } = setup();
    const button = createButtonBlock();
    findBlockLocation(doc, blockIds[0])!.column.blocks.push(button);
    store.getState().select({ kind: "blocks", blockIds: [blockIds[0], button.id] });
    const before = store.getState();
    expect(canDetachSelection(doc, before.selection)).toBe(false);
    expect(commitDetachSelection(store)).toBe(false);
    expect(store.getState()).toBe(before);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "仅正文、标题和图片模块可转为自由定位" }));
    store.getState().undo();
    expect(store.getState()).toBe(before);
  });

  it("超过自由元素上限时提示并保留整批源模块", () => {
    const { store, blockIds, doc } = setup();
    doc.freeItems = Array.from({ length: CANVAS_LIMITS.maxFreeItems - 1 }, (_, i) => ({
      id: `free-${i}`, block: createTextBlock(), x: 0, y: 0, width: 80, zIndex: i,
    }));
    store.getState().select({ kind: "blocks", blockIds });
    const before = store.getState();
    expect(commitDetachSelection(store)).toBe(false);
    expect(store.getState()).toBe(before);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("最多 100 个") }));
  });

  it.each(["readOnly", "previewMode"] as const)("%s 阻止执行且不提示成功", (mode) => {
    const { store, blockIds } = setup();
    store.getState().select({ kind: "block", blockId: blockIds[0] });
    store.setState({ [mode]: true });
    const before = store.getState();
    expect(commitDetachSelection(store)).toBe(false);
    expect(store.getState()).toBe(before);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("属性栏抽出入口", () => {
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

  it.each([false, true])("单选/多选（%s）按钮执行共用事务并显示自由属性", (multi) => {
    const { store, blockIds, scene } = setup();
    store.getState().select(multi ? { kind: "blocks", blockIds } : { kind: "block", blockId: blockIds[0] });
    act(() => root.render(createElement(CanvasPropertyBar, { store, scene, measurer: { measure: () => 92 } })));
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("转为自由定位"));
    expect(button?.textContent).toBe(multi ? "转为自由定位（2）" : "转为自由定位");
    act(() => button!.click());
    expect(store.getState().doc.freeItems).toHaveLength(multi ? 2 : 1);
    expect(container.querySelector(`[aria-label="${multi ? "多个自由元素属性" : "自由容器属性"}"]`)).not.toBeNull();
  });

  it("不支持的模块和混合选区没有入口", () => {
    const { store, blockIds, doc } = setup();
    const button = createButtonBlock();
    findBlockLocation(doc, blockIds[0])!.column.blocks.push(button);
    act(() => root.render(createElement(CanvasPropertyBar, { store, measurer: { measure: () => 92 } })));
    for (const selection of [
      { kind: "block" as const, blockId: button.id },
      { kind: "blocks" as const, blockIds: [blockIds[0], button.id] },
    ]) {
      act(() => store.getState().select(selection));
      expect(container.textContent).not.toContain("转为自由定位");
    }
  });
});
