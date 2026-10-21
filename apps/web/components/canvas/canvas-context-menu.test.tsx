// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasOpenDialog } from "@/lib/hooks/use-hotkey";
import { canvasShortcutLabels } from "./canvas-shortcuts";
import {
  CanvasClipboardMenu,
  canvasContextMenuModel,
  isNativeEditTarget,
  resolveCanvasContextTarget,
  selectionForContextTarget,
  type CanvasContextMenuAction,
  type CanvasContextMenuRequest,
} from "./canvas-context-menu";

const labels = canvasShortcutLabels("MacIntel");

function item(label: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll<HTMLElement>("[role=menuitem]")].find((entry) =>
    entry.textContent?.replace(/\s+/g, "").includes(label));
}

describe("canvas context menu model", () => {
  it("只给可抽出的模块选区显示入口，只读和预览时禁用", () => {
    for (const selection of [
      { kind: "block" as const, blockId: "b" },
      { kind: "blocks" as const, blockIds: ["a", "b"] },
    ]) {
      for (const readOnly of [false, true]) {
        const entries = canvasContextMenuModel({ scope: "element", selection, readOnly, hasClipboard: false, labels, canDetach: true });
        const duplicate = entries.findIndex((entry) => entry.id === "duplicate");
        expect(entries[duplicate + 1]).toMatchObject({ id: "detach-to-free", label: "转为自由定位", disabled: readOnly });
        expect(entries[duplicate + 2].id).toBe("delete");
      }
      expect(canvasContextMenuModel({ scope: "element", selection, readOnly: false, hasClipboard: false, labels, canDetach: false })
        .some((entry) => entry.id === "detach-to-free")).toBe(false);
    }
  });
  it("shows paste, select-all, and zoom on empty canvas", () => {
    const entries = canvasContextMenuModel({
      scope: "canvas",
      selection: { kind: "block", blockId: "b" },
      readOnly: false,
      hasClipboard: true,
      labels,
    });
    expect(entries.map((entry) => entry.label)).toEqual(["粘贴到此处", "全选", "缩放到适合"]);
    expect(entries.map((entry) => entry.shortcut)).toEqual(["⌘V", "⌘A", "⇧1"]);
    expect(entries.map((entry) => entry.disabled)).toEqual([false, false, false]);
    const blocked = canvasContextMenuModel({
      scope: "canvas",
      selection: null,
      readOnly: true,
      hasClipboard: false,
      labels: canvasShortcutLabels("Win32"),
    });
    expect(blocked.map((entry) => [entry.shortcut, entry.disabled])).toEqual([
      ["Ctrl+V", true],
      ["Ctrl+A", false],
      ["Shift+1", false],
    ]);
  });

  it("disables cut, paste, duplicate, and delete when they cannot run", () => {
    const block = canvasContextMenuModel({
      scope: "element",
      selection: { kind: "block", blockId: "b" },
      readOnly: false,
      hasClipboard: true,
      labels,
    });
    expect(block.map((entry) => entry.label)).toEqual(["复制", "剪切", "粘贴", "创建副本", "删除"]);
    expect(block.every((entry) => !entry.disabled)).toBe(true);
    const readonly = canvasContextMenuModel({
      scope: "element",
      selection: { kind: "region", boardId: "bd", regionId: "r" },
      readOnly: true,
      hasClipboard: true,
      labels,
    });
    expect(readonly.find((entry) => entry.id === "copy")?.disabled).toBe(false);
    expect(readonly.filter((entry) => entry.id !== "copy").every((entry) => entry.disabled)).toBe(true);
    const board = canvasContextMenuModel({
      scope: "element",
      selection: { kind: "board", boardId: "bd" },
      readOnly: false,
      hasClipboard: false,
      labels,
    });
    expect(board.find((entry) => entry.id === "copy")?.disabled).toBe(true);
    expect(board.find((entry) => entry.id === "cut")?.disabled).toBe(true);
    expect(board.find((entry) => entry.id === "duplicate")?.disabled).toBe(true);
    expect(board.find((entry) => entry.id === "paste")?.disabled).toBe(true);
    expect(board.find((entry) => entry.id === "delete")?.disabled).toBe(false);
  });

  it("shows align, distribute, and layer groups only for free items", () => {
    const one = canvasContextMenuModel({
      scope: "element",
      selection: { kind: "free", itemId: "f" },
      readOnly: false,
      hasClipboard: true,
      labels,
    });
    expect(one.filter((entry) => entry.heading).map((entry) => entry.label)).toEqual(["对齐", "分布", "图层"]);
    expect(one.find((entry) => entry.id === "align-left")).toMatchObject({ disabled: true, title: "至少选择 2 个自由元素" });
    expect(one.find((entry) => entry.id === "distribute-x")?.disabled).toBe(true);
    expect(one.find((entry) => entry.id === "layer-front")?.disabled).toBe(false);
    const two = canvasContextMenuModel({
      scope: "element",
      selection: { kind: "frees", itemIds: ["a", "b"] },
      readOnly: false,
      hasClipboard: false,
      labels,
    });
    expect(two.find((entry) => entry.id === "align-bottom")?.disabled).toBe(false);
    expect(two.find((entry) => entry.id === "distribute-y")?.disabled).toBe(true);
    const three = canvasContextMenuModel({
      scope: "element",
      selection: { kind: "frees", itemIds: ["a", "b", "c"] },
      readOnly: false,
      hasClipboard: false,
      labels,
    });
    expect(three.find((entry) => entry.id === "distribute-x")?.disabled).toBe(false);
    const locked = canvasContextMenuModel({
      scope: "element",
      selection: { kind: "frees", itemIds: ["a", "b", "c"] },
      readOnly: true,
      hasClipboard: true,
      labels,
    });
    expect(locked.find((entry) => entry.id === "copy")?.disabled).toBe(false);
    expect(locked.find((entry) => entry.id === "layer-back")?.title).toBe("只读时不能调整自由元素");
    expect(locked.find((entry) => entry.id === "align-left")?.disabled).toBe(true);
  });
});

describe("context target resolution", () => {
  function mount(node: HTMLElement): HTMLElement {
    document.body.appendChild(node);
    return node;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers native editing, then free items, then blocks, regions, boards, and canvas", () => {
    const input = mount(document.createElement("input"));
    const block = document.createElement("div");
    block.dataset.blockId = "b1";
    block.appendChild(input);
    expect(resolveCanvasContextTarget(input)).toEqual({ kind: "native" });
    expect(isNativeEditTarget(input)).toBe(true);

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    const host = document.createElement("div");
    host.dataset.blockId = "b2";
    host.appendChild(editable);
    const locked = document.createElement("span");
    locked.contentEditable = "false";
    editable.appendChild(locked);
    mount(host);
    expect(resolveCanvasContextTarget(editable)).toEqual({ kind: "native" });
    expect(resolveCanvasContextTarget(locked)).toEqual({ kind: "block", blockId: "b2" });

    const free = document.createElement("div");
    free.dataset.freeItemId = "f1";
    const inner = document.createElement("div");
    inner.dataset.blockId = "hidden";
    free.appendChild(inner);
    mount(free);
    expect(resolveCanvasContextTarget(inner)).toEqual({ kind: "free", itemId: "f1" });

    const board = document.createElement("div");
    board.dataset.boardId = "bd";
    const region = document.createElement("div");
    region.dataset.regionId = "rg";
    const regionBlock = document.createElement("div");
    regionBlock.dataset.blockId = "b3";
    region.appendChild(regionBlock);
    board.appendChild(region);
    const padding = document.createElement("div");
    board.appendChild(padding);
    mount(board);
    expect(resolveCanvasContextTarget(regionBlock)).toEqual({ kind: "block", blockId: "b3" });
    expect(resolveCanvasContextTarget(region)).toEqual({ kind: "region", boardId: "bd", regionId: "rg" });
    expect(resolveCanvasContextTarget(padding)).toEqual({ kind: "board", boardId: "bd" });
    expect(resolveCanvasContextTarget(document.createElement("div"))).toEqual({ kind: "canvas" });
  });

  it("keeps a multi-selection when the target is already inside it", () => {
    const blocks = { kind: "blocks" as const, blockIds: ["a", "b"] };
    expect(selectionForContextTarget(blocks, { kind: "block", blockId: "b" })).toBe(blocks);
    expect(selectionForContextTarget(blocks, { kind: "block", blockId: "c" })).toEqual({ kind: "block", blockId: "c" });
    const frees = { kind: "frees" as const, itemIds: ["f1", "f2"] };
    expect(selectionForContextTarget(frees, { kind: "free", itemId: "f2" })).toBe(frees);
    const region = { kind: "region" as const, boardId: "bd", regionId: "r" };
    expect(selectionForContextTarget(region, region)).toBe(region);
    expect(selectionForContextTarget(blocks, { kind: "board", boardId: "bd" })).toEqual({ kind: "board", boardId: "bd" });
  });
});

describe("canvas context menu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  function renderMenu(request: CanvasContextMenuRequest, onSelect: (action: CanvasContextMenuAction) => void, readOnly = false) {
    const entries = canvasContextMenuModel({
      scope: request.scope,
      selection: { kind: "block", blockId: "b" },
      readOnly,
      hasClipboard: !readOnly,
      labels,
    });
    act(() => {
      root.render(createElement(CanvasClipboardMenu, { request, entries, onSelect }) as ReactNode);
    });
  }

  it("opens a menu, ignores disabled items, and closes on escape or an outside click", () => {
    const onSelect = vi.fn();
    const request: CanvasContextMenuRequest = { x: 20, y: 30, world: { x: 1, y: 2 }, scope: "element", nonce: 1 };
    renderMenu(request, onSelect, true);
    const menu = document.body.querySelector("[data-testid=canvas-context-menu]");
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(hasOpenDialog()).toBe(true);
    expect(item("复制")?.getAttribute("aria-disabled")).not.toBe("true");
    expect(item("剪切")?.getAttribute("aria-disabled")).toBe("true");
    act(() => { item("剪切")?.click(); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.body.querySelector("[role=menu]")).not.toBeNull();
    act(() => { item("复制")?.click(); });
    expect(onSelect).toHaveBeenCalledWith("copy");
    expect(document.body.querySelector("[role=menu]")).toBeNull();

    renderMenu({ ...request, nonce: 2, scope: "canvas" }, onSelect);
    expect(item("粘贴到此处")?.textContent).toContain("⌘V");
    expect(item("剪切")).toBeUndefined();
    expect(item("全选")?.textContent).toContain("⌘A");
    expect(item("缩放到适合")?.textContent).toContain("⇧1");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(hasOpenDialog()).toBe(false);

    renderMenu({ ...request, nonce: 3 }, onSelect);
    expect(document.body.querySelector("[role=menu]")).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.body.querySelector("[role=menu]")).toBeNull();
  });

  it("runs an enabled align action and ignores a disabled distribute action", () => {
    const onSelect = vi.fn();
    const entries = canvasContextMenuModel({
      scope: "element",
      selection: { kind: "frees", itemIds: ["a", "b"] },
      readOnly: false,
      hasClipboard: false,
      labels,
    });
    const request: CanvasContextMenuRequest = { x: 12, y: 16, world: { x: 0, y: 0 }, scope: "element", nonce: 8 };
    act(() => {
      root.render(createElement(CanvasClipboardMenu, { request, entries, onSelect }) as ReactNode);
    });
    expect(item("左对齐")?.getAttribute("aria-disabled")).not.toBe("true");
    expect(item("水平分布")?.getAttribute("aria-disabled")).toBe("true");
    expect(item("置于顶层")).toBeTruthy();
    act(() => { item("水平分布")?.click(); });
    expect(onSelect).not.toHaveBeenCalled();
    act(() => { item("左对齐")?.click(); });
    expect(onSelect).toHaveBeenCalledWith("align-left");
  });

  it("dispatches detach-to-free and prevents read-only execution", () => {
    const onSelect = vi.fn();
    for (const readOnly of [true, false]) {
      const entries = canvasContextMenuModel({
        scope: "element", selection: { kind: "block", blockId: "b" }, readOnly,
        hasClipboard: false, labels, canDetach: true,
      });
      act(() => root.render(createElement(CanvasClipboardMenu, {
        request: { x: 10, y: 20, world: { x: 0, y: 0 }, scope: "element", nonce: readOnly ? 1 : 2 }, entries, onSelect,
      })));
      act(() => item("转为自由定位")?.click());
      if (readOnly) expect(onSelect).not.toHaveBeenCalled();
      else expect(onSelect).toHaveBeenCalledExactlyOnceWith("detach-to-free");
    }
  });
});
