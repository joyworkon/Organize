// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFreeShape } from "@/lib/canvas/commands";
import { emptyDoc } from "@/lib/canvas/model";
import { CanvasPropertyBar } from "./canvas-property-bar";
import { CanvasFreeItemView } from "./canvas-free-item";
import { CanvasAddPanel } from "./canvas-add-panel";
import { createCanvasStore } from "./canvas-store";

describe("自由形状界面", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("创建/种类/背景/圆角各自可撤销；椭圆隐藏圆角，形状不允许移入区块或文本编辑", () => {
    const store = createCanvasStore({ doc: emptyDoc() });
    store.getState().apply("创建", (doc) => createFreeShape(doc, { x: 0, y: 0, kind: "rect" }));
    const item = store.getState().doc.freeItems[0];
    store.getState().startEdit(item.id);
    expect(store.getState().editingBlockId).toBeNull();
    act(() => root.render(createElement(CanvasPropertyBar, { store, measurer: { measure: () => 60 } })));
    expect(container.querySelector("h3")?.textContent).toBe("自由形状");
    expect(container.textContent).not.toContain("移入区块");
    expect(container.querySelector('input[type="range"]')).not.toBeNull();
    const click = (selector: string) => act(() => container.querySelector<HTMLButtonElement>(selector)!.click());
    click('button[role="radio"]:nth-child(2)');
    expect(store.getState().doc.freeItems[0].block).toMatchObject({ kind: "ellipse" });
    expect(container.querySelector('input[type="range"]')).toBeNull();
    click('[aria-label="背景：绿"]');
    click('[aria-label="背景：默认"]');
    expect(store.getState().doc.freeItems[0].block.style).toEqual({ background: null, radius: 8 });
    act(() => store.getState().undo());
    expect(store.getState().doc.freeItems[0].block.style?.background).toBe("green");
    act(() => store.getState().undo());
    act(() => store.getState().undo());
    expect(store.getState().doc.freeItems).toEqual([item]);
    act(() => store.getState().undo());
    expect(store.getState().doc.freeItems).toEqual([]);
    act(() => store.getState().redo());
    expect(store.getState().doc.freeItems).toEqual([item]);
  });

  it.each([true, false])("形状无图片占位或文本输入；可编辑=%s 时手柄与端口符合权限", (interactive) => {
    const doc = createFreeShape(emptyDoc(), { x: 0, y: 0, kind: "ellipse" }).doc;
    const store = createCanvasStore({ doc, readOnly: !interactive });
    act(() => root.render(createElement(CanvasFreeItemView, {
      item: doc.freeItems[0], height: 126, store, zoom: 1, interactive, selected: interactive,
      editing: false, userId: "user", assetUrls: {}, snapTargets: [], snapTargetsFor: () => [],
      getGroupMembers: () => null, grouped: false, groupLive: null, onGroupLive: vi.fn(), onSnapGuides: vi.fn(),
      onConnect: interactive ? vi.fn() : undefined,
    })));
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector(".canvas-image-placeholder")).toBeNull();
    expect(container.querySelectorAll(".canvas-resize-handle")).toHaveLength(interactive ? 8 : 0);
    expect(container.querySelectorAll(".canvas-connector-port")).toHaveLength(interactive ? 4 : 0);
    if (interactive) {
      expect(container.querySelector<HTMLElement>('[data-connector-port="top"]')?.style.top).toBe("-28px");
      expect(container.querySelector<HTMLElement>('[data-connector-port="bottom"]')?.style.top).toBe("calc(100% + 28px)");
    }
    expect(container.querySelector<HTMLElement>("[data-free-item-id]")?.style.borderRadius).toBe("50%");
  });

  it("添加面板提供可用名称与类型回调", () => {
    const add = vi.fn();
    const noop = vi.fn();
    act(() => root.render(createElement(CanvasAddPanel, {
      store: createCanvasStore(), hint: "添加到：新页面", narrow: false,
      onAddBlock: noop, onAddBlankBoard: noop, onAddLandingBoard: noop,
      onAddFreeText: noop, onAddFreeImage: noop, onAddFreeSticky: noop, onAddFreeShape: add,
      onApplyTemplate: noop, onReveal: noop,
    })));
    act(() => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "自由放置")!.click());
    for (const name of ["矩形", "椭圆"]) act(() => container.querySelector<HTMLButtonElement>(`[aria-label="新建${name}"]`)!.click());
    expect(add.mock.calls).toEqual([["rect"], ["ellipse"]]);
  });
});
