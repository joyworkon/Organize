// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasFindBar } from "./canvas-find-bar";
import { findCanvasContent } from "@/lib/canvas/board-find";
import { createBoardShape, emptyDoc } from "@/lib/canvas/model";

const doc = emptyDoc();
doc.boards = [0, 1].map((x) => ({ ...createBoardShape({ x: x * 1000, y: 0 }), name: `alpha ${x}` }));
const onClose = vi.fn();
function Harness({ focusNonce = 0 }: { focusNonce?: number }) {
  const [query, setQuery] = useState("alpha");
  const [index, setIndex] = useState(0);
  const hits = findCanvasContent(doc, query);
  return <CanvasFindBar query={query} onQueryChange={(q) => { setQuery(q); setIndex(0); }} hits={hits} index={index}
    onStep={(step) => { if (hits.length) setIndex((n) => (n + step + hits.length) % hits.length); }}
    onClose={onClose} focusNonce={focusNonce} />;
}

describe("CanvasFindBar", () => {
  let container: HTMLDivElement, root: Root;
  const input = () => container.querySelector<HTMLInputElement>("input")!;
  const status = () => container.querySelector('[role="status"]')!.textContent;
  const key = (key: string, extra: KeyboardEventInit = {}) => act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  });
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onClose.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  it("是非模态查找条，自动聚焦全选，重复打开再次全选", () => {
    expect(container.querySelector('[role="search"]')!.getAttribute("aria-label")).toBe("画布内查找");
    expect(container.querySelector('[data-testid="canvas-find-bar"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(input().getAttribute("aria-label")).toBe("查找画布内容");
    expect(document.activeElement).toBe(input());
    expect(input().selectionEnd).toBe(5);
    input().setSelectionRange(1, 1);
    act(() => root.render(<Harness focusNonce={1} />));
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(5);
  });
  it("计数、上下按钮与 Enter/Shift+Enter/↑↓循环", () => {
    expect(status()).toBe("1 / 2");
    key("Enter"); expect(status()).toBe("2 / 2");
    key("ArrowDown"); expect(status()).toBe("1 / 2");
    key("Enter", { shiftKey: true }); expect(status()).toBe("2 / 2");
    key("ArrowUp"); expect(status()).toBe("1 / 2");
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="上一处"]')!.click());
    expect(status()).toBe("2 / 2");
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一处"]')!.click());
    expect(status()).toBe("1 / 2");
    expect(container.querySelector("mark")!.textContent).toBe("alpha");
  });
  it("受控查询、无命中和空查询显示 0/0 并禁用导航", () => {
    for (const value of ["没有", ""]) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(status()).toBe("0 / 0");
      expect(container.querySelector<HTMLButtonElement>('[aria-label="下一处"]')!.disabled).toBe(true);
      expect(container.querySelector("mark")).toBeNull();
    }
  });
  it("IME 与修饰键期间不跳转，关闭按钮复用共享 Button", () => {
    key("Enter", { isComposing: true }); key("ArrowDown", { keyCode: 229 }); key("Enter", { metaKey: true });
    expect(status()).toBe("1 / 2");
    const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭画布查找"]')!;
    expect(close.classList.contains("focus-visible:ring-2")).toBe(true);
    act(() => close.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
