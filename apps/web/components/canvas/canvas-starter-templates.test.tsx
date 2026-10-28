// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeScene } from "@/lib/canvas/layout";
import { emptyDoc, type CanvasDoc } from "@/lib/canvas/model";
import {
  CANVAS_STARTER_TEMPLATE_IDS,
  applyCanvasStarterTemplate,
  canvasStarterTemplateName,
} from "@/lib/canvas/starter-templates";
import { createCanvasStore } from "./canvas-store";
import { CanvasStarterTemplates } from "./canvas-starter-templates";
import { CanvasViewportView, type CanvasViewportProps } from "./canvas-viewport";

let container: HTMLDivElement;
let root: Root;

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

function options(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".canvas-starter-option"));
}

function key(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

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

describe("CanvasStarterTemplates 面板", () => {
  it("列出五个内容模板 + 空白画布，每项有图标、名称与一行说明，容器带可访问名", () => {
    render(createElement(CanvasStarterTemplates, { onSelect: vi.fn(), onDismiss: vi.fn() }));
    const group = container.querySelector('[role="group"][aria-label="快速开始"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute("data-testid")).toBe("canvas-starter-panel");
    const items = options();
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.dataset.starterOption)).toEqual([...CANVAS_STARTER_TEMPLATE_IDS, "blank"]);
    for (const [index, id] of CANVAS_STARTER_TEMPLATE_IDS.entries()) {
      expect(items[index].textContent).toContain(canvasStarterTemplateName(id));
      expect(items[index].querySelector("svg.ds-icon")).not.toBeNull();
      expect(items[index].querySelector(".canvas-starter-option-desc")?.textContent).not.toBe("");
    }
    expect(items[5].textContent).toContain("空白画布");
  });

  it("点击模板触发 onSelect，点击空白画布只触发 onDismiss", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    render(createElement(CanvasStarterTemplates, { onSelect, onDismiss }));
    act(() => options()[1].click());
    expect(onSelect).toHaveBeenCalledWith("flowchart");
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => options()[5].click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("方向键 / Home / End 在选项间循环移动焦点，Esc 关闭（按钮上与容器上都可达）", () => {
    const onDismiss = vi.fn();
    render(createElement(CanvasStarterTemplates, { onSelect: vi.fn(), onDismiss }));
    const items = options();
    act(() => items[0].focus());
    key(items[0], "ArrowRight");
    expect(document.activeElement).toBe(items[1]);
    key(items[1], "ArrowDown");
    expect(document.activeElement).toBe(items[2]);
    key(items[2], "ArrowLeft");
    expect(document.activeElement).toBe(items[1]);
    key(items[1], "End");
    expect(document.activeElement).toBe(items[5]);
    key(items[5], "ArrowRight");
    expect(document.activeElement).toBe(items[0]);
    key(items[0], "ArrowUp");
    expect(document.activeElement).toBe(items[5]);
    key(items[5], "Home");
    expect(document.activeElement).toBe(items[0]);
    key(items[0], "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    key(container.querySelector('[role="group"]')!, "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

describe("视口里的快速开始面板显隐", () => {
  function mount(overrides: Partial<CanvasViewportProps> & { doc?: CanvasDoc }) {
    const doc = overrides.doc ?? emptyDoc();
    const store = overrides.store ?? createCanvasStore({ doc });
    const props: CanvasViewportProps = {
      store,
      doc,
      scene: computeScene(doc, () => 24),
      userId: "user",
      interactive: true,
      spaceHeld: false,
      selection: null,
      editingBlockId: null,
      assetUrls: {},
      sourceStatuses: new Map(),
      starter: { open: true, onSelect: vi.fn(), onDismiss: vi.fn() },
      ...overrides,
    };
    render(createElement(CanvasViewportView, props));
    return { store, props };
  }
  const panel = () => container.querySelector('[data-testid="canvas-starter-panel"]');
  const hint = () => container.querySelector(".canvas-empty-hint");

  it("可编辑 + 完全空白 + 会话未关闭：显示面板，不显示双击提示", () => {
    mount({});
    expect(panel()).not.toBeNull();
    expect(hint()).toBeNull();
  });

  it("本次会话已关闭：退回一句双击提示", () => {
    mount({ starter: { open: false, onSelect: vi.fn(), onDismiss: vi.fn() } });
    expect(panel()).toBeNull();
    expect(hint()?.textContent).toContain("双击画布任意位置");
  });

  it("预览 / 只读 / 手机（非 interactive）：不显示面板，只显示只读空态文案", () => {
    mount({ interactive: false });
    expect(panel()).toBeNull();
    expect(hint()?.textContent).toContain("这张画布还没有内容");
  });

  it("画布不再空白后面板消失；画笔模式下也不显示", () => {
    const filled = applyCanvasStarterTemplate(emptyDoc(), { template: "brainstorm", center: { x: 0, y: 0 } }).doc;
    mount({ doc: filled });
    expect(panel()).toBeNull();
    expect(hint()).toBeNull();
    const pen = createCanvasStore({ doc: emptyDoc() });
    pen.getState().setTool("pen");
    mount({ store: pen });
    expect(panel()).toBeNull();
  });

  it("点击模板调用 onSelect 并带模板 id；Esc 调用 onDismiss", () => {
    const onSelect = vi.fn();
    const onDismiss = vi.fn();
    mount({ starter: { open: true, onSelect, onDismiss } });
    const first = container.querySelector<HTMLButtonElement>('[data-starter-option="kanban"]')!;
    act(() => first.click());
    expect(onSelect).toHaveBeenCalledWith("kanban");
    key(first, "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("起步模板是一条可撤销事务", () => {
  it.each(CANVAS_STARTER_TEMPLATE_IDS)("%s：一次 apply 进历史，一次 undo 回到空白并清空选区，redo 原样恢复", (template) => {
    const store = createCanvasStore({ doc: emptyDoc() });
    const before = store.getState().doc;
    store.getState().apply(`快速开始：${canvasStarterTemplateName(template)}`, (doc) =>
      applyCanvasStarterTemplate(doc, { template, center: { x: 400, y: 300 } }),
    );
    const after = store.getState().doc;
    expect(after).not.toBe(before);
    expect(after.boards.length + after.freeItems.length).toBeGreaterThan(0);
    expect(store.getState().selection).not.toBeNull();
    expect(store.getState().editingBlockId).toBeNull();
    expect(store.getState().history.canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
    expect(store.getState().selection).toBeNull();
    expect(store.getState().history.canUndo).toBe(false);
    store.getState().redo();
    expect(store.getState().doc).toEqual(after);
  });

  it("只读与预览态 apply 被拒绝，文档不变", () => {
    const readOnly = createCanvasStore({ doc: emptyDoc(), readOnly: true });
    readOnly.getState().apply("快速开始", (doc) => applyCanvasStarterTemplate(doc, { template: "swot", center: { x: 0, y: 0 } }));
    expect(readOnly.getState().doc).toEqual(emptyDoc());
    const preview = createCanvasStore({ doc: emptyDoc() });
    preview.getState().togglePreview();
    preview.getState().apply("快速开始", (doc) => applyCanvasStarterTemplate(doc, { template: "swot", center: { x: 0, y: 0 } }));
    expect(preview.getState().doc).toEqual(emptyDoc());
  });
});
