// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFreeText } from "@/lib/canvas/commands";
import { emptyDoc } from "@/lib/canvas/model";
import { CanvasPropertyBar } from "./canvas-property-bar";
import { createCanvasStore, type CanvasStore } from "./canvas-store";
import type { FreeArrangeBox } from "./free-item-actions";

let container: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label);
}

function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`找不到按钮 ${label}`);
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function threeFree() {
  let doc = createFreeText(emptyDoc(), { x: 0, y: 0, width: 100 }).doc;
  doc = createFreeText(doc, { x: 150, y: 40, width: 80 }).doc;
  doc = createFreeText(doc, { x: 400, y: 10, width: 60 }).doc;
  const store = createCanvasStore({ doc });
  const [a, b, c] = store.getState().doc.freeItems;
  const boxes: FreeArrangeBox[] = [
    { itemId: a.id, height: 40 },
    { itemId: b.id, height: 100 },
    { itemId: c.id, height: 20 },
  ];
  return { store, a, b, c, boxes };
}

function mountBar(store: CanvasStore, boxes: readonly FreeArrangeBox[]) {
  render(createElement(CanvasPropertyBar, { store, measurer: { measure: () => 20 }, freeBoxes: boxes }));
}

describe("自由元素对齐分布图层", () => {
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

  it("多选可以按场景高度对齐，撤销一次回到原位，选区不塌缩", () => {
    const { store, a, b, c, boxes } = threeFree();
    store.getState().select({ kind: "frees", itemIds: [a.id, b.id] });
    mountBar(store, boxes);
    expect(button("水平分布")?.disabled).toBe(true);
    expect(button("水平分布")?.title).toBe("至少选择 3 个自由元素");
    expect(button("左对齐")?.disabled).toBe(false);
    const before = store.getState().doc;
    click("底对齐");
    const placed = store.getState().doc.freeItems;
    expect(placed.find((item) => item.id === a.id)).toMatchObject({ x: 0, y: 100 });
    expect(placed.find((item) => item.id === b.id)).toMatchObject({ x: 150, y: 40 });
    expect(placed.find((item) => item.id === c.id)).toMatchObject({ x: 400, y: 10 });
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id] });
    expect(store.getState().history.peekUndoLabel()).toBe("底对齐自由元素");
    store.getState().undo();
    expect(store.getState().doc).toBe(before);
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id] });
  });

  it("三个自由元素水平分布后两端不动，一次撤销恢复", () => {
    const { store, a, b, c, boxes } = threeFree();
    store.getState().select({ kind: "frees", itemIds: [a.id, b.id, c.id] });
    mountBar(store, boxes);
    expect(button("水平分布")?.disabled).toBe(false);
    const before = store.getState().doc;
    click("水平分布");
    const placed = store.getState().doc.freeItems;
    expect(placed.map((item) => item.x)).toEqual([0, 210, 400]);
    expect(placed.map((item) => item.y)).toEqual([0, 40, 10]);
    store.getState().undo();
    expect(store.getState().doc).toBe(before);
  });

  it("置于顶层后选中项都在未选项之上，再点一次不会多一条撤销", () => {
    const { store, a, b, c, boxes } = threeFree();
    store.getState().select({ kind: "frees", itemIds: [a.id, b.id] });
    mountBar(store, boxes);
    const before = store.getState().doc;
    click("置于顶层");
    const zOf = new Map(store.getState().doc.freeItems.map((item) => [item.id, item.zIndex]));
    expect(zOf.get(c.id)).toBeLessThan(zOf.get(a.id) ?? 0);
    expect(zOf.get(a.id)).toBeLessThan(zOf.get(b.id) ?? 0);
    store.getState().undo();
    expect(store.getState().doc).toBe(before);
    mountBar(store, boxes);
    expect(button("置于顶层")?.disabled).toBe(false);
    click("置于顶层");
    mountBar(store, boxes);
    expect(button("置于顶层")?.disabled).toBe(true);
    expect(button("置于顶层")?.title).toBe("已经在最上层");
    store.getState().undo();
    expect(store.getState().doc).toBe(before);
  });

  it("单选只有图层，版面模块多选不出现对齐", () => {
    const { store, a, boxes } = threeFree();
    store.getState().select({ kind: "free", itemId: a.id });
    mountBar(store, boxes);
    expect(container.querySelector("[aria-label='自由容器属性']")).toBeTruthy();
    expect(button("置于顶层")).toBeTruthy();
    expect(button("左对齐")).toBeUndefined();
    store.getState().select({ kind: "blocks", blockIds: ["m1", "m2"] });
    mountBar(store, boxes);
    expect(container.textContent).toContain("已选中 2 个模块");
    expect(button("左对齐")).toBeUndefined();
    expect(button("置于顶层")).toBeUndefined();
  });

  it("混合锁定选区禁用对齐分布，全锁后可批量解锁，保留选区", () => {
    const { store, a, b, c, boxes } = threeFree();
    store.getState().doc.freeItems[0].locked = true;
    store.getState().select({ kind: "frees", itemIds: [a.id, b.id, c.id] });
    mountBar(store, boxes);
    expect(button("左对齐")?.disabled).toBe(true);
    expect(button("水平分布")?.disabled).toBe(true);
    expect(button("左对齐")?.title).toBe("先解锁再对齐或分布");
    expect(button("置于顶层")?.title).toBe("已经在最上层");
    expect(button("锁定自由元素")?.textContent).toContain("锁定所选");
    click("锁定自由元素");
    expect(button("解锁自由元素")?.textContent).toContain("解锁所选");
    expect(store.getState().selection).toEqual({ kind: "frees", itemIds: [a.id, b.id, c.id] });
    click("解锁自由元素");
    expect(button("左对齐")?.disabled).toBe(false);
    expect(button("水平分布")?.disabled).toBe(false);
  });

  it("单选锁定后移入区块禁用，预览和只读不出现锁定入口", () => {
    const { store, a, boxes } = threeFree();
    store.getState().select({ kind: "free", itemId: a.id });
    mountBar(store, boxes);
    click("锁定自由元素");
    const move = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("移入区块…"));
    expect(move?.disabled).toBe(true);
    expect(move?.title).toBe("先解锁再移入区块");
    act(() => store.setState({ readOnly: true }));
    expect(button("解锁自由元素")).toBeUndefined();
    act(() => store.setState({ readOnly: false, previewMode: true }));
    expect(button("解锁自由元素")).toBeUndefined();
  });
});
