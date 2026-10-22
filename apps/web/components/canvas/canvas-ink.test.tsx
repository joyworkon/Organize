// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createFreeInk, createBoard } from "@/lib/canvas/commands";
import { computeScene } from "@/lib/canvas/layout";
import { emptyDoc } from "@/lib/canvas/model";
import { createCanvasStore } from "./canvas-store";
import { CanvasPropertyBar } from "./canvas-property-bar";
import { CanvasBoardExportSurface } from "./canvas-board-export";
import { matchCanvasShortcut } from "./canvas-shortcuts";

const stroke = { x: 20, y: 20, width: 100, height: 40, points: [0, 0, 40, 40, 100, 0] };
it("P only matches outside text input, composition and modifier shortcuts", () => {
  expect(matchCanvasShortcut(new KeyboardEvent("keydown", { key: "p" }))).toBe("pen");
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    expect(matchCanvasShortcut(new KeyboardEvent("keydown", { key: "p", ...extra }))).toBeNull();
  }
  const target = document.createElement("textarea");
  const e = new KeyboardEvent("keydown", { key: "p", bubbles: true }); target.dispatchEvent(e);
  expect(matchCanvasShortcut(e)).toBeNull();
});

describe("ink UI and history", () => {
  it("one stroke per undo; styles undo individually; preview and read-only disable tool", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const store = createCanvasStore();
    store.getState().setTool("pen");
    store.getState().apply("绘制笔迹", (doc) => createFreeInk(doc, stroke));
    const container = document.createElement("div"), root = createRoot(container);
    try {
      act(() => root.render(<CanvasPropertyBar store={store} measurer={{ measure: () => 24 }} />));
      expect(container.querySelector("h3")?.textContent).toBe("笔迹");
      expect(container.textContent).not.toContain("移入区块");
      expect(container.querySelector('input[type="range"]')).toBeNull();
      act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent === "粗")!.click());
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="颜色：红"]')!.click());
      expect(store.getState().doc.freeItems[0].block).toMatchObject({ color: "red", strokeWidth: 8 });
      act(() => store.getState().undo());
      expect(store.getState().doc.freeItems[0].block).toMatchObject({ color: "", strokeWidth: 8 });
      act(() => store.getState().undo());
      expect(store.getState().doc.freeItems[0].block).toMatchObject({ strokeWidth: 4 });
      act(() => store.getState().undo());
      expect(store.getState().doc.freeItems).toHaveLength(0);
      act(() => store.getState().redo());
      expect(store.getState().doc.freeItems).toHaveLength(1);
      act(() => store.getState().togglePreview());
      expect(store.getState().tool).toBe("select");
      store.getState().setTool("pen");
      expect(store.getState().tool).toBe("select");
      const readonly = createCanvasStore({ readOnly: true }); readonly.getState().setTool("pen");
      expect(readonly.getState().tool).toBe("select");
    } finally { act(() => root.unmount()); }
  });
  it("PNG export surface includes ink SVG without controls", () => {
    const doc = createFreeInk(createBoard(emptyDoc(), { x: 0, y: 0 }).doc, stroke).doc;
    const container = document.createElement("div"), root = createRoot(container);
    try {
      act(() => root.render(<CanvasBoardExportSurface doc={doc} scene={computeScene(doc, () => 24)} store={createCanvasStore({ doc })} assetUrls={{}} boardId={doc.boards[0].id} />));
      expect(container.querySelector('[data-ink="true"] svg path')?.getAttribute("d")).toContain("Q");
      expect(container.querySelector(".canvas-resize-handle, textarea, .canvas-image-placeholder")).toBeNull();
    } finally { act(() => root.unmount()); }
  });
});
