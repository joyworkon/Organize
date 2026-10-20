// @vitest-environment jsdom
import { act, createElement, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFreeText } from "@/lib/canvas/commands";
import { computeScene, type Scene, type SceneBlockBox, type SceneFreeItem } from "@/lib/canvas/layout";
import { emptyDoc, type CanvasFreeItem } from "@/lib/canvas/model";
import { CanvasFreeItemView } from "./canvas-free-item";
import { CanvasPropertyBar } from "./canvas-property-bar";
import { createCanvasStore, type CanvasStore } from "./canvas-store";
import { CanvasViewportView } from "./canvas-viewport";
import { useCanvasPointer } from "./use-canvas-pointer";

let container: HTMLDivElement;
let root: Root;
let restoreCapture: () => void;

function installPointerEvent() {
  if (typeof globalThis.PointerEvent === "function") return;
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

function installPointerCapture() {
  const proto = HTMLElement.prototype;
  const previous = {
    set: proto.setPointerCapture,
    has: proto.hasPointerCapture,
    release: proto.releasePointerCapture,
  };
  const caps = new WeakMap<EventTarget, Set<number>>();
  proto.setPointerCapture = function (id: number) {
    const held = caps.get(this) ?? new Set<number>();
    held.add(id);
    caps.set(this, held);
  };
  proto.hasPointerCapture = function (id: number) {
    return caps.get(this)?.has(id) ?? false;
  };
  proto.releasePointerCapture = function (id: number) {
    caps.get(this)?.delete(id);
    this.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: id }));
  };
  return () => {
    proto.setPointerCapture = previous.set;
    proto.hasPointerCapture = previous.has;
    proto.releasePointerCapture = previous.release;
  };
}

function dispatchPointer(target: Element, type: string, init: PointerEventInit) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
}

function twoItems() {
  let doc = createFreeText(emptyDoc(), { x: 10, y: 12 }).doc;
  doc = createFreeText(doc, { x: 320, y: 16 }).doc;
  const store = createCanvasStore({ doc });
  store.getState().setViewport({ x: 0, y: 0, zoom: 1 });
  const [a, b] = store.getState().doc.freeItems;
  return { store, a, b };
}

function freeBox(item: CanvasFreeItem, x = item.x, y = item.y): SceneFreeItem {
  return { itemId: item.id, x, y, width: item.width, height: 48, zIndex: item.zIndex };
}

function sceneOf(freeItems: SceneFreeItem[], block?: SceneBlockBox): Scene {
  return {
    boards: block
      ? [{
          boardId: "board",
          x: 0,
          y: 0,
          width: 480,
          height: 320,
          regions: [{
            regionId: "region",
            y: 0,
            height: 200,
            sections: [{
              sectionId: "section",
              y: 0,
              height: 200,
              columnWidths: [200],
              columns: [{ columnId: "column", x: 0, y: 0, width: 200, height: 200, blocks: [block] }],
            }],
          }],
        }]
      : [],
    freeItems,
  };
}

function MarqueeHarness({ store, scene, interactive = true }: { store: CanvasStore; scene: Scene; interactive?: boolean }) {
  const pointer = useCanvasPointer(store, scene, interactive, false);
  return (
    <div
      className="canvas-viewport"
      onPointerDownCapture={pointer.down}
      onPointerMoveCapture={pointer.move}
      onPointerUp={(e) => pointer.finish(e)}
    >
      <div className="canvas-world" />
    </div>
  );
}

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

function FreePair({ store, items, interactive = true }: { store: CanvasStore; items: CanvasFreeItem[]; interactive?: boolean }) {
  const [groupLive, setGroupLive] = useState<{ dx: number; dy: number } | null>(null);
  const onSnapGuides = useCallback(() => {}, []);
  const snapTargetsFor = useCallback(() => [], []);
  const selected = store.getState().selection;
  const ids = selected?.kind === "frees" ? selected.itemIds : selected?.kind === "free" ? [selected.itemId] : [];
  return (
    <>
      {items.map((item) => (
        <CanvasFreeItemView
          key={item.id}
          item={item}
          height={48}
          store={store}
          zoom={1}
          interactive={interactive}
          selected={ids.includes(item.id)}
          editing={false}
          userId="user"
          assetUrls={{}}
          snapTargets={[]}
          snapTargetsFor={snapTargetsFor}
          getGroupMembers={() => {
            const live = store.getState().selection;
            const memberIds = live?.kind === "frees" ? live.itemIds : [];
            if (memberIds.length < 2) return null;
            return memberIds.flatMap((id) => {
              const current = store.getState().doc.freeItems.find((entry) => entry.id === id);
              return current ? [{ id, x: current.x, y: current.y, width: current.width, height: 48 }] : [];
            });
          }}
          grouped={ids.length > 1 && ids.includes(item.id)}
          groupLive={ids.length > 1 && ids.includes(item.id) ? groupLive : null}
          onGroupLive={setGroupLive}
          onSnapGuides={onSnapGuides}
        />
      ))}
    </>
  );
}

describe("自由元素多选交互", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    installPointerEvent();
    restoreCapture = installPointerCapture();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreCapture();
  });

  it("框选只命中自由元素时选成 frees；碰到模块则维持模块选区", () => {
    const { store, a, b } = twoItems();
    render(<MarqueeHarness store={store} scene={sceneOf([freeBox(a), freeBox(b)])} />);
    const viewport = container.querySelector(".canvas-viewport") as HTMLElement;
    viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() { return {}; } });
    const world = container.querySelector(".canvas-world") as HTMLElement;
    dispatchPointer(world, "pointerdown", { clientX: 0, clientY: 0 });
    dispatchPointer(world, "pointermove", { clientX: 500, clientY: 80 });
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id] });

    const block: SceneBlockBox = { blockId: "block-1", x: 0, y: 0, width: 100, height: 40 };
    render(<MarqueeHarness store={store} scene={sceneOf([freeBox(a), freeBox(b)], block)} />);
    const again = container.querySelector(".canvas-viewport") as HTMLElement;
    again.getBoundingClientRect = viewport.getBoundingClientRect;
    dispatchPointer(container.querySelector(".canvas-world") as HTMLElement, "pointerdown", { clientX: 0, clientY: 0 });
    dispatchPointer(container.querySelector(".canvas-world") as HTMLElement, "pointermove", { clientX: 500, clientY: 80 });
    expect(store.getState().selection).toEqual({ kind: "block", blockId: "block-1" });
  });

  it("Shift 框选追加自由元素；空白 Shift 框选保留已有模块", () => {
    const { store, a, b } = twoItems();
    store.getState().select({ kind: "free", itemId: a.id });
    render(<MarqueeHarness store={store} scene={sceneOf([freeBox(a), freeBox(b)])} />);
    const viewport = container.querySelector(".canvas-viewport") as HTMLElement;
    viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() { return {}; } });
    const world = container.querySelector(".canvas-world") as HTMLElement;
    dispatchPointer(world, "pointerdown", { clientX: 300, clientY: 0, shiftKey: true });
    dispatchPointer(world, "pointermove", { clientX: 420, clientY: 80, shiftKey: true });
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id] });

    store.getState().select({ kind: "blocks", blockIds: ["kept"] });
    render(<MarqueeHarness store={store} scene={sceneOf([freeBox(a, 2000, 2000), freeBox(b, 2200, 2000)])} />);
    const blank = container.querySelector(".canvas-viewport") as HTMLElement;
    blank.getBoundingClientRect = viewport.getBoundingClientRect;
    const blankWorld = container.querySelector(".canvas-world") as HTMLElement;
    dispatchPointer(blankWorld, "pointerdown", { clientX: 0, clientY: 0, shiftKey: true });
    dispatchPointer(blankWorld, "pointermove", { clientX: 30, clientY: 20, shiftKey: true });
    expect(store.getState().selection).toEqual({ kind: "block", blockId: "kept" });
  });

  it("只读框选不能建立多选", () => {
    const { store, a, b } = twoItems();
    render(<MarqueeHarness store={store} scene={sceneOf([freeBox(a), freeBox(b)])} interactive={false} />);
    const viewport = container.querySelector(".canvas-viewport") as HTMLElement;
    viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() { return {}; } });
    const world = container.querySelector(".canvas-world") as HTMLElement;
    dispatchPointer(world, "pointerdown", { clientX: 0, clientY: 0 });
    dispatchPointer(world, "pointermove", { clientX: 500, clientY: 80 });
    expect(store.getState().selection).toBeNull();
  });

  it("Shift 点击加减选；单击已选成员保持整组", () => {
    const { store, a, b } = twoItems();
    store.getState().select({ kind: "free", itemId: a.id });
    render(<FreePair store={store} items={[a, b]} />);
    const items = () => [...container.querySelectorAll(".canvas-free-item")];
    dispatchPointer(items()[1], "pointerdown", { clientX: 10, clientY: 10, shiftKey: true });
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id] });
    render(<FreePair store={store} items={[a, b]} />);
    dispatchPointer(container.querySelectorAll(".canvas-free-item")[0], "pointerdown", { clientX: 10, clientY: 10 });
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id] });
    dispatchPointer(container.querySelectorAll(".canvas-free-item")[0], "pointerup", { clientX: 10, clientY: 10 });
    expect(store.getState().doc.freeItems.map((item) => item.x)).toEqual([10, 320]);
    render(<FreePair store={store} items={[a, b]} />);
    dispatchPointer(container.querySelectorAll(".canvas-free-item")[0], "pointerdown", { clientX: 10, clientY: 10, shiftKey: true });
    expect(store.getState().selection).toEqual({ kind: "free", itemId: b.id });
  });

  it("拖动已选成员时整组移动，一条撤销回到原位", () => {
    const { store, a, b } = twoItems();
    store.getState().select({ kind: "frees", itemIds: [a.id, b.id] });
    const before = store.getState().doc;
    render(<FreePair store={store} items={[a, b]} />);
    const leader = container.querySelector(".canvas-free-item") as HTMLElement;
    dispatchPointer(leader, "pointerdown", { clientX: 40, clientY: 40 });
    dispatchPointer(leader, "pointermove", { clientX: 80, clientY: 55 });
    dispatchPointer(leader, "pointerup", { clientX: 80, clientY: 55 });
    expect(store.getState().doc.freeItems.map((item) => [item.x, item.y])).toEqual([[50, 27], [360, 31]]);
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id] });
    store.getState().undo();
    expect(store.getState().doc).toBe(before);
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id] });
  });

  it("只读时点击自由元素不会选中或拖动", () => {
    const { store, a, b } = twoItems();
    render(<FreePair store={store} items={[a, b]} interactive={false} />);
    const leader = container.querySelector(".canvas-free-item") as HTMLElement;
    dispatchPointer(leader, "pointerdown", { clientX: 0, clientY: 0, shiftKey: true });
    dispatchPointer(leader, "pointermove", { clientX: 40, clientY: 0 });
    dispatchPointer(leader, "pointerup", { clientX: 40, clientY: 0 });
    expect(store.getState().selection).toBeNull();
    expect(store.getState().doc.freeItems.map((item) => item.x)).toEqual([10, 320]);
  });

  it("多选画出每个选中描边、一个虚线外框和一枚自由定位徽标", () => {
    const { store, a, b } = twoItems();
    store.getState().select({ kind: "frees", itemIds: [a.id, b.id] });
    const doc = store.getState().doc;
    render(createElement(CanvasViewportView, {
      store,
      doc,
      scene: computeScene(doc, () => 24),
      userId: "user",
      interactive: true,
      spaceHeld: false,
      selection: store.getState().selection,
      editingBlockId: null,
      assetUrls: {},
      sourceStatuses: new Map(),
    }));
    expect(container.querySelectorAll(".canvas-free-item.is-selected")).toHaveLength(2);
    expect(container.querySelectorAll(".canvas-free-group")).toHaveLength(1);
    expect(container.querySelectorAll(".canvas-free-badge")).toHaveLength(1);
    expect(container.querySelector(".canvas-free-group .canvas-free-badge")?.getAttribute("aria-label")).toBe("自由定位元素");
    expect(container.querySelector(".canvas-free-move")).toBeNull();
  });

  it("属性栏显示个数、复制和删除，不出现样式控件", () => {
    const { store, a, b } = twoItems();
    store.getState().select({ kind: "frees", itemIds: [a.id, b.id] });
    render(createElement(CanvasPropertyBar, { store, measurer: { measure: () => 20 } }));
    const bar = container.querySelector("[aria-label='多个自由元素属性']");
    expect(bar?.textContent).toContain("已选 2 个自由元素");
    expect(bar?.textContent).not.toContain("字号");
    expect(bar?.textContent).not.toContain("标题");
    const button = (label: string) => [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(label));
    act(() => {
      button("复制")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(store.getState().doc.freeItems).toHaveLength(4);
    expect(store.getState().selection?.kind).toBe("frees");
    act(() => {
      button("删除")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(store.getState().doc.freeItems).toHaveLength(2);
    expect(store.getState().history.canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().doc.freeItems).toHaveLength(4);
    store.getState().undo();
    expect(store.getState().doc.freeItems).toHaveLength(2);
  });
});
