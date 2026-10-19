// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCK_COMMANDS } from "./block-commands";
import { focusAndHighlightBlock } from "./extensions/block-selection";
import { findListParent, setListStyle } from "./extensions/list-style";
import { BlockActionMenu } from "./block-action-menu";
import type { EditorBlockTarget } from "./types";

vi.mock("@/components/ui/prompt-dialog", () => ({ showPrompt: vi.fn() }));
vi.mock("./extensions/block-selection", () => ({ focusAndHighlightBlock: vi.fn() }));
vi.mock("./extensions/list-style", () => ({ findListParent: vi.fn(() => null), setListStyle: vi.fn() }));
vi.mock("./block-commands", async () => {
  const { FileInput } = await import("@/components/icons");
  return {
    BLOCK_COMMANDS: [{ id: "heading-1", label: "标题 1", icon: FileInput, canTransform: true, run: vi.fn(), preview: { sample: "标题预览", caption: "转换预览" } }],
    commandMatches: (command: { label: string }, query: string) => command.label.includes(query),
  };
});

const schema = new Schema({ nodes: {
  doc: { content: "block+" },
  paragraph: { content: "text*", group: "block" },
  text: { group: "inline" },
} });

describe("BlockActionMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editor: Editor;
  let target: EditorBlockTarget;
  const onClose = vi.fn();
  const onPresent = vi.fn();
  const skill = { id: "skill", label: "整理笔记", run: vi.fn() };
  const chain = {
    focus: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    unsetColor: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };

  function render(skills = [skill]) {
    act(() => root.render(<BlockActionMenu editor={editor} noteId="note-1" target={target} point={{ left: 100, top: 100 }} skills={skills} onClose={onClose} onPresent={onPresent} />));
  }
  function button(label: string, selector = "button") {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((node) => node.querySelector("span:not(.color-swatch):not(.skill-icon):not(.list-style-preview)")?.textContent === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  function click(label: string, selector?: string) {
    act(() => button(label, selector).click());
  }
  function expectSharedButtons() {
    for (const button of document.querySelectorAll("button")) {
      expect(button.classList.contains("focus-visible:ring-2")).toBe(true);
      expect(button.textContent?.trim()).toBeTruthy();
    }
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(findListParent).mockReturnValue(null);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("原文")), schema.node("paragraph", null, schema.text("保留"))]);
    editor = {
      state: EditorState.create({ schema, doc }),
      view: { dispatch: vi.fn() },
      commands: { focus: vi.fn(), setBlockBackground: vi.fn() },
      chain: vi.fn(() => chain),
    } as unknown as Editor;
    target = { pos: 0, type: "paragraph", id: "block-1", text: "原文", json: { type: "paragraph" } };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps deletion on the original transaction and uses visible danger styles", () => {
    expectSharedButtons();
    expect(button("删除").classList.contains("text-destructive")).toBe(true);
    expect(button("删除").classList.contains("hover:text-destructive")).toBe(true);
    click("删除");
    const transaction = vi.mocked(editor.view.dispatch).mock.calls[0][0];
    expect(transaction.doc.textContent).toBe("保留");
    expect(editor.commands.focus).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves complex block delete confirmation and cancellation", () => {
    target.type = "columns";
    // The existing confirmation also applies to large text blocks.
    const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("x".repeat(501)))]);
    editor = { ...editor, state: EditorState.create({ schema, doc }) } as Editor;
    render();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    click("删除");
    expect(confirm).toHaveBeenCalledOnce();
    expect(editor.view.dispatch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it("preserves transform preview, execution and target highlight", () => {
    expect(button("转换成").getAttribute("aria-pressed")).toBe("false");
    click("转换成");
    expect(button("转换成").getAttribute("aria-pressed")).toBe("true");
    expect(button("转换成").classList.contains("bg-accent")).toBe(true);
    expectSharedButtons();
    act(() => button("标题 1").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(document.querySelector(".block-transform-preview-sample")?.textContent).toBe("标题预览");
    click("标题 1");
    expect(BLOCK_COMMANDS[0].run).toHaveBeenCalledExactlyOnceWith(editor, 0);
    expect(focusAndHighlightBlock).toHaveBeenCalledExactlyOnceWith(editor, "block-1");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps color labels and text/background commands", () => {
    click("颜色");
    expectSharedButtons();
    expect(button("蓝色").querySelector(".text-swatch")?.getAttribute("aria-hidden")).toBe("true");
    click("蓝色");
    expect(chain.setColor).toHaveBeenCalledWith("#337ea9");
    expect(chain.run).toHaveBeenCalledOnce();
    click("无背景");
    expect(editor.commands.setBlockBackground).toHaveBeenCalledWith(0, null);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("exposes the selected list style and preserves setListStyle arguments", () => {
    vi.mocked(findListParent).mockReturnValue({ type: "orderedList", pos: 0, style: "lower-alpha", node: editor.state.doc.firstChild! });
    render();
    click("列表格式");
    expectSharedButtons();
    expect(button("字母").getAttribute("aria-pressed")).toBe("true");
    expect(button("字母").classList.contains("bg-accent")).toBe(true);
    expect(button("数字").getAttribute("aria-pressed")).toBe("false");
    click("数字");
    expect(setListStyle).toHaveBeenCalledExactlyOnceWith(editor, 0, "decimal");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps skill execution and the empty state", () => {
    click("技能");
    expectSharedButtons();
    click("整理笔记");
    expect(skill.run).toHaveBeenCalledExactlyOnceWith(target);
    expect(onClose).toHaveBeenCalledOnce();
    render([]);
    expect(document.querySelector(".editor-menu-empty")?.textContent).toBe("没有已启用的笔记技能");
  });
});
