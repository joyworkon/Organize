// @vitest-environment jsdom
/**
 * 查找条：计数、上下跳转、Esc 关闭并清高亮、只读不提供替换、操作钮用共享 Button。
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteFindBar } from "./note-search-dialog";

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("NoteFindBar", () => {
  let editor: Editor;
  let container: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();

  function render(editable = true) {
    act(() => {
      editor.setEditable(editable);
      root.render(<NoteFindBar editor={editor} onClose={onClose} />);
    });
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onClose.mockClear();
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit],
      content: "<p>alpha 一</p><p>alpha 二</p>",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    editor.destroy();
    document.body.innerHTML = "";
  });

  function queryInput() {
    return container.querySelector<HTMLInputElement>('[aria-label="搜索本页内容"]')!;
  }

  function status() {
    return container.querySelector('[role="status"]')?.textContent ?? "";
  }

  it("打开后是查找条而不是全屏弹层，操作钮带共享焦点环", () => {
    expect(container.querySelector('[role="search"]')?.getAttribute("aria-label")).toBe("页面内搜索");
    expect(container.querySelector(".editor-dialog-backdrop")).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(queryInput().getAttribute("placeholder")).toBe("搜索本页内容…");
    expect(status()).toBe("");
    for (const label of ["上一处", "下一处", "关闭", "展开替换"]) {
      const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
      expect(button, label).toBeTruthy();
      expect(button!.classList.contains("focus-visible:ring-2")).toBe(true);
    }
  });

  it("有命中时显示 N / M，下一处与 Enter 循环，Esc 关闭并清高亮", () => {
    act(() => setInputValue(queryInput(), "alpha"));
    expect(status()).toBe("1 / 2");
    expect(editor.view.dom.querySelectorAll(".organize-search-hit")).toHaveLength(1);

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一处"]')!.click());
    expect(status()).toBe("2 / 2");
    expect(container.querySelector('[aria-label="跳转到第 2 处"]')?.getAttribute("aria-current")).toBe("true");

    act(() => queryInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(status()).toBe("1 / 2");

    act(() => queryInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })));
    expect(status()).toBe("2 / 2");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    expect(document.querySelector(".organize-search-hit")).toBeNull();
  });

  it("零命中显示 0 / 0，点击结果行同步当前索引", () => {
    act(() => setInputValue(queryInput(), "没有"));
    expect(status()).toBe("0 / 0");
    expect(container.textContent).toContain("无结果");

    act(() => setInputValue(queryInput(), "alpha"));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="跳转到第 2 处"]')!.click());
    expect(status()).toBe("2 / 2");
  });

  it("可编辑时单处替换并跳到下一处；只读不渲染替换", () => {
    act(() => setInputValue(queryInput(), "alpha"));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="展开替换"]')!.click());
    const replaceInput = container.querySelector<HTMLInputElement>('[aria-label="替换为"]')!;
    act(() => setInputValue(replaceInput, "β"));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="替换"]')!.click());
    expect(editor.state.doc.textContent).toBe("β 一alpha 二");
    expect(status()).toBe("1 / 1");

    render(false);
    expect(container.querySelector('[aria-label="展开替换"]')).toBeNull();
    expect(container.querySelector('[aria-label="替换"]')).toBeNull();
    expect(container.querySelector('[role="search"]')).toBeTruthy();
  });
});
