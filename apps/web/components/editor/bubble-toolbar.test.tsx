// @vitest-environment jsdom

import type { Editor } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { BubbleToolbar } from "./bubble-toolbar";

vi.mock("@/components/ui/prompt-dialog", () => ({ showPrompt: vi.fn() }));

describe("BubbleToolbar", () => {
  let container: HTMLDivElement;
  let root: Root;
  let activeMarks: Set<string>;
  let editor: Editor;
  let href: string | undefined;
  const chain = {
    focus: vi.fn().mockReturnThis(),
    toggleBold: vi.fn().mockReturnThis(),
    toggleItalic: vi.fn().mockReturnThis(),
    toggleUnderline: vi.fn().mockReturnThis(),
    toggleStrike: vi.fn().mockReturnThis(),
    toggleCode: vi.fn().mockReturnThis(),
    setLink: vi.fn().mockReturnThis(),
    unsetLink: vi.fn().mockReturnThis(),
    insertInlineMath: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    toggleHeading: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  const callbacks = {
    onEditLink: vi.fn(),
    onUploadImage: vi.fn(),
    onAddImageUrl: vi.fn(),
    onUploadAttachment: vi.fn(),
    onAddTable: vi.fn(),
    onAddReference: vi.fn(),
  };

  function render() {
    act(() => root.render(<BubbleToolbar editor={editor} {...callbacks} />));
  }

  function button(name: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll("button")).find(
      (node) => (node.getAttribute("aria-label") || node.textContent) === name
    );
    if (!found) throw new Error(`Missing button: ${name}`);
    return found;
  }

  function click(name: string) {
    act(() => button(name).click());
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    activeMarks = new Set();
    href = undefined;
    editor = {
      isActive: (name: string) => activeMarks.has(name),
      getAttributes: (name: string) => name === "link" ? { href } : {},
      chain: vi.fn(() => chain),
    } as unknown as Editor;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([
    ["粗体", "bold", "toggleBold"],
    ["斜体", "italic", "toggleItalic"],
    ["下划线", "underline", "toggleUnderline"],
    ["删除线", "strike", "toggleStrike"],
    ["行内代码", "code", "toggleCode"],
  ] as const)("keeps %s commands and reflects both pressed states", (label, mark, command) => {
    expect(button(label).getAttribute("aria-pressed")).toBe("false");
    click(label);
    expect(chain.focus).toHaveBeenCalledOnce();
    expect(chain[command]).toHaveBeenCalledOnce();
    expect(chain.run).toHaveBeenCalledOnce();
    activeMarks.add(mark);
    render();
    expect(button(label).getAttribute("aria-pressed")).toBe("true");
    expect(button(label).classList.contains("bg-accent")).toBe(true);
    click(label);
    expect(chain[command]).toHaveBeenCalledTimes(2);
    activeMarks.delete(mark);
    render();
    expect(button(label).getAttribute("aria-pressed")).toBe("false");
    expect(button(label).classList.contains("bg-accent")).toBe(false);
  });

  it("exposes names, shared focus rings and expanded state on every main control", () => {
    for (const control of container.querySelectorAll("button")) {
      expect(control.getAttribute("aria-label")).toBeTruthy();
      expect(control.classList.contains("focus-visible:ring-2")).toBe(true);
    }
    for (const label of ["文本", "颜色", "插入表情", "插入", "更多"]) {
      expect(button(label).getAttribute("aria-expanded")).toBe("false");
      click(label);
      expect(button(label).getAttribute("aria-expanded")).toBe("true");
      expect(button(label).classList.contains("bg-accent")).toBe(true);
      act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
      expect(button(label).getAttribute("aria-expanded")).toBe("false");
    }
    for (const [label, mark] of [["链接", "link"], ["行内公式", "inlineMath"]]) {
      expect(button(label).getAttribute("aria-pressed")).toBe("false");
      activeMarks.add(mark);
      render();
      expect(button(label).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("keeps block, color and emoji actions and closes their dropdowns", () => {
    click("文本");
    click("标题 1");
    expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 1 });
    expect(button("文本").getAttribute("aria-expanded")).toBe("false");
    click("颜色");
    const blue = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "A蓝色")!;
    expect(blue.classList.contains("focus-visible:ring-2")).toBe(true);
    act(() => blue.click());
    expect(chain.setColor).toHaveBeenCalledWith("#337ea9");
    expect(button("颜色").getAttribute("aria-expanded")).toBe("false");
    click("插入表情");
    expect(button("😀").classList.contains("focus-visible:ring-2")).toBe(true);
    click("😀");
    expect(chain.insertContent).toHaveBeenCalledWith("😀");
    expect(button("插入表情").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the inline link editor instead of a modal prompt", () => {
    click("链接");
    expect(callbacks.onEditLink).toHaveBeenCalledExactlyOnceWith();
    expect(showPrompt).not.toHaveBeenCalled();
  });

  it("keeps the inline formula prompt and insertion command", async () => {
    vi.mocked(showPrompt).mockResolvedValueOnce("x^2");
    await act(async () => button("行内公式").click());
    expect(showPrompt).toHaveBeenCalledWith({ title: "输入 LaTeX 公式", placeholder: "例如 a^2 + b^2 = c^2" });
    expect(chain.insertInlineMath).toHaveBeenCalledWith("x^2");
    expect(chain.run).toHaveBeenCalledOnce();
  });

  it("keeps upload, URL, attachment, reference and table callback signatures", () => {
    for (const [label, callback] of [
      ["上传图片", callbacks.onUploadImage],
      ["图片 URL", callbacks.onAddImageUrl],
      ["上传附件", callbacks.onUploadAttachment],
      ["引用阅读条目", callbacks.onAddReference],
    ] as const) {
      click("插入");
      click(label);
      expect(callback).toHaveBeenCalledExactlyOnceWith();
      expect(button("插入").getAttribute("aria-expanded")).toBe("false");
    }
    click("插入");
    click("表格");
    click("返回插入菜单");
    click("表格");
    click("3 行 4 列");
    expect(callbacks.onAddTable).toHaveBeenCalledExactlyOnceWith(3, 4);
    expect(button("插入").getAttribute("aria-expanded")).toBe("false");
  });
});
