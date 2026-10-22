// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFreeText } from "@/lib/canvas/commands";
import { computeScene } from "@/lib/canvas/layout";
import { createBoardShape, emptyDoc } from "@/lib/canvas/model";
import { touchTargetKind } from "@/lib/canvas/touch-gesture";
import { createCanvasStore } from "./canvas-store";
import { CanvasViewportView } from "./canvas-viewport";

let container: HTMLDivElement;
let root: Root;
let restoreCapture: () => void;
let restorePointerEvent: () => void;

function installPointerEvent() {
  const previous = globalThis.PointerEvent;
  if (typeof previous === "function") return () => {};
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "";
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
  return () => {
    globalThis.PointerEvent = previous;
  };
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

function dispatchPointer(target: Element, type: string, init: PointerEventInit = {}) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
    pointerType: "touch",
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

function boardFixture() {
  const doc = { ...emptyDoc(), boards: [createBoardShape({ x: 0, y: 0 })] };
  const store = createCanvasStore({ doc });
  store.getState().setViewport({ x: 40, y: 40, zoom: 1 });
  return { store, doc, scene: computeScene(doc, () => 24) };
}

function renderBoard(interactive: boolean) {
  const fixture = boardFixture();
  render(createElement(CanvasViewportView, {
    store: fixture.store,
    doc: fixture.doc,
    scene: fixture.scene,
    userId: "user",
    interactive,
    spaceHeld: false,
    selection: null,
    editingBlockId: null,
    assetUrls: {},
    sourceStatuses: new Map(),
  }));
  return fixture;
}

describe("canvas touch gestures", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    restorePointerEvent = installPointerEvent();
    restoreCapture = installPointerCapture();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    restoreCapture();
    restorePointerEvent();
  });

  it("treats the viewport as blank, a block as content, and a field as native", () => {
    const viewport = document.createElement("div");
    viewport.className = "canvas-viewport";
    const block = document.createElement("div");
    block.className = "canvas-block";
    const field = document.createElement("textarea");
    block.appendChild(field);
    viewport.appendChild(block);
    expect(touchTargetKind(viewport)).toBe("blank");
    expect(touchTargetKind(block)).toBe("content");
    expect(touchTargetKind(field)).toBe("native");
  });

  it("pans a read-only canvas when one finger drags a block", () => {
    const { store } = renderBoard(false);
    const block = container.querySelector("[data-block-id]") as HTMLElement;
    dispatchPointer(block, "pointerdown", { clientX: 100, clientY: 100 });
    dispatchPointer(block, "pointermove", { clientX: 160, clientY: 130 });
    expect(store.getState().viewport).toEqual({ x: 100, y: 70, zoom: 1 });
  });

  it("does not pan when one finger drags a block in edit mode", () => {
    const { store } = renderBoard(true);
    const block = container.querySelector("[data-block-id]") as HTMLElement;
    dispatchPointer(block, "pointerdown", { clientX: 100, clientY: 100 });
    dispatchPointer(block, "pointermove", { clientX: 160, clientY: 130 });
    expect(store.getState().viewport).toEqual({ x: 40, y: 40, zoom: 1 });
  });

  it("zooms with two fingers and clamps the spread", () => {
    const { store } = renderBoard(false);
    const viewport = container.querySelector("[data-testid='canvas-viewport']") as HTMLElement;
    dispatchPointer(viewport, "pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(viewport, "pointerdown", { pointerId: 2, clientX: 140, clientY: 100 });
    dispatchPointer(viewport, "pointermove", { pointerId: 2, clientX: 500, clientY: 100 });
    expect(store.getState().viewport.zoom).toBe(4);
  });

  it("cancels an in-progress block drag when the second finger pinches", () => {
    const { store } = renderBoard(true);
    const before = JSON.stringify(store.getState().doc);
    const block = container.querySelector("[data-block-id]") as HTMLElement;
    const viewport = container.querySelector("[data-testid='canvas-viewport']") as HTMLElement;
    dispatchPointer(block, "pointerdown", { pointerId: 1, clientX: 80, clientY: 80 });
    dispatchPointer(block, "pointermove", { pointerId: 1, clientX: 900, clientY: 900 });
    dispatchPointer(viewport, "pointerdown", { pointerId: 2, clientX: 940, clientY: 900 });
    dispatchPointer(viewport, "pointermove", { pointerId: 2, clientX: 1400, clientY: 900 });
    dispatchPointer(block, "pointerup", { pointerId: 1, clientX: 900, clientY: 900 });
    dispatchPointer(viewport, "pointerup", { pointerId: 2, clientX: 1400, clientY: 900 });
    expect(JSON.stringify(store.getState().doc)).toBe(before);
    expect(store.getState().viewport.zoom).toBeGreaterThan(1);
    expect(store.getState().viewport.zoom).toBeLessThanOrEqual(4);
  });

  it("cancels a free-item drag when the second finger pinches", () => {
    const doc = createFreeText(emptyDoc(), { x: 10, y: 12 }).doc;
    const store = createCanvasStore({ doc });
    store.getState().setViewport({ x: 40, y: 40, zoom: 1 });
    const scene = computeScene(doc, () => 24);
    render(createElement(CanvasViewportView, {
      store,
      doc,
      scene,
      userId: "user",
      interactive: true,
      spaceHeld: false,
      selection: null,
      editingBlockId: null,
      assetUrls: {},
      sourceStatuses: new Map(),
    }));
    const before = doc.freeItems.map((item) => ({ x: item.x, y: item.y }));
    const item = container.querySelector(".canvas-free-item") as HTMLElement;
    const viewport = container.querySelector("[data-testid='canvas-viewport']") as HTMLElement;
    dispatchPointer(item, "pointerdown", { pointerId: 1, clientX: 20, clientY: 20 });
    dispatchPointer(item, "pointermove", { pointerId: 1, clientX: 80, clientY: 70 });
    dispatchPointer(viewport, "pointerdown", { pointerId: 2, clientX: 60, clientY: 20 });
    dispatchPointer(viewport, "pointermove", { pointerId: 2, clientX: 460, clientY: 20 });
    dispatchPointer(item, "pointerup", { pointerId: 1, clientX: 80, clientY: 70 });
    dispatchPointer(viewport, "pointerup", { pointerId: 2, clientX: 460, clientY: 20 });
    expect(store.getState().doc.freeItems.map((entry) => ({ x: entry.x, y: entry.y }))).toEqual(before);
    expect(store.getState().viewport.zoom).toBeGreaterThan(1);
  });

  it("read-only viewport preserves the current preview page selection", () => {
    const { store, doc, scene } = boardFixture();
    store.getState().select({ kind: "board", boardId: doc.boards[0].id });
    render(createElement(CanvasViewportView, {
      store, doc, scene, userId: "user", interactive: false, spaceHeld: false,
      selection: store.getState().selection, editingBlockId: null, assetUrls: {}, sourceStatuses: new Map(),
    }));
    expect(store.getState().selection).toEqual({ kind: "board", boardId: doc.boards[0].id });
  });

  it("second finger cancels unfinished ink and continues pinch without committing a stroke", () => {
    const { store } = renderBoard(true);
    act(() => store.getState().setTool("pen"));
    const viewport = container.querySelector("[data-testid='canvas-viewport']") as HTMLElement;
    dispatchPointer(viewport, "pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
    dispatchPointer(viewport, "pointermove", { pointerId: 1, clientX: 150, clientY: 150 });
    expect(container.querySelector(".canvas-ink-draft")).not.toBeNull();
    dispatchPointer(viewport, "pointerdown", { pointerId: 2, clientX: 200, clientY: 150 });
    dispatchPointer(viewport, "pointermove", { pointerId: 2, clientX: 300, clientY: 150 });
    dispatchPointer(viewport, "pointerup", { pointerId: 1, clientX: 150, clientY: 150 });
    dispatchPointer(viewport, "pointerup", { pointerId: 2, clientX: 300, clientY: 150 });
    expect(container.querySelector(".canvas-ink-draft")).toBeNull();
    expect(store.getState().doc.freeItems).toHaveLength(0);
    expect(store.getState().viewport.zoom).toBeGreaterThan(1);
  });

  it.each(["blur", "preview", "lostcapture"])("%s cancels ink without a save or undo transaction", (cancel) => {
    const { store } = renderBoard(true);
    act(() => store.getState().setTool("pen"));
    const viewport = container.querySelector("[data-testid='canvas-viewport']") as HTMLElement;
    dispatchPointer(viewport, "pointerdown", { pointerType: "mouse", clientX: 100, clientY: 100 });
    dispatchPointer(viewport, "pointermove", { pointerType: "mouse", clientX: 150, clientY: 150 });
    if (cancel === "blur") act(() => window.dispatchEvent(new Event("blur")));
    if (cancel === "preview") act(() => store.getState().togglePreview());
    if (cancel === "lostcapture") act(() => viewport.releasePointerCapture(1));
    dispatchPointer(viewport, "pointerup", { pointerType: "mouse", clientX: 150, clientY: 150 });
    expect(container.querySelector(".canvas-ink-draft")).toBeNull();
    expect(store.getState().doc.freeItems).toHaveLength(0);
    expect(store.getState().localSeq).toBe(0);
  });

  it("keeps mouse dragging from panning, and still pans with the middle button", () => {
    const { store } = renderBoard(false);
    const block = container.querySelector("[data-block-id]") as HTMLElement;
    const viewport = container.querySelector("[data-testid='canvas-viewport']") as HTMLElement;
    dispatchPointer(block, "pointerdown", { pointerType: "mouse", clientX: 100, clientY: 100 });
    dispatchPointer(block, "pointermove", { pointerType: "mouse", clientX: 180, clientY: 140 });
    expect(store.getState().viewport).toEqual({ x: 40, y: 40, zoom: 1 });
    dispatchPointer(viewport, "pointerdown", { pointerType: "mouse", button: 1, clientX: 100, clientY: 100 });
    dispatchPointer(viewport, "pointermove", { pointerType: "mouse", button: 1, clientX: 150, clientY: 130 });
    expect(store.getState().viewport).toEqual({ x: 90, y: 70, zoom: 1 });
  });
});
