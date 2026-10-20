// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockStyle } from "./extensions/block-style";
import { Callout } from "./extensions/callout";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlockMultiSelectBar } from "./block-multi-select-bar";
import { BlockMultiSelect, getMultiSelectedBlocks, setMultiSelectedBlocks } from "./extensions/block-multi-select";

describe("block multi-selection action bar", () => {
  let editor: Editor;
  let container: HTMLDivElement;
  let root: Root;
  function render() {
    act(() => root.render(<BlockMultiSelectBar editor={editor} count={getMultiSelectedBlocks(editor).length} />));
  }
  function click(label: string) {
    const button = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    act(() => button.click());
  }
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({ element, extensions: [StarterKit, BlockMultiSelect, BlockStyle, Callout], editorProps: { handleScrollToSelection: () => true }, content: "<p>甲</p><p>乙</p><p>丙</p>" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setMultiSelectedBlocks(editor, [0, 3]);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    editor.destroy();
    document.body.innerHTML = "";
  });

  it("exposes the selection count, shared buttons and duplication of all selected blocks", () => {
    expect(container.querySelector('[role="status"]')?.textContent).toBe("已选 2 个块");
    for (const button of container.querySelectorAll("button")) expect(button.classList.contains("focus-visible:ring-2")).toBe(true);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    container.querySelector("button")!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(getMultiSelectedBlocks(editor)).toEqual([0, 3]);
    click("创建多选块副本");
    expect(editor.state.doc.textContent).toBe("甲甲乙乙丙");
    expect(getMultiSelectedBlocks(editor)).toHaveLength(2);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent).toBe("甲乙丙");
  });

  it("deletes only selected blocks and supports undo", () => {
    click("删除多选块");
    expect(editor.state.doc.textContent).toBe("丙");
    expect(getMultiSelectedBlocks(editor)).toEqual([]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent).toBe("甲乙丙");
  });

  it("cancels selection without deleting content", () => {
    click("取消块多选");
    expect(getMultiSelectedBlocks(editor)).toEqual([]);
    expect(editor.state.doc.textContent).toBe("甲乙丙");
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("disables mutations while readonly and keeps cancellation available", () => {
    editor.setEditable(false);
    render();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="创建多选块副本"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="删除多选块"]')!.disabled).toBe(true);
    click("删除多选块");
    expect(editor.state.doc.textContent).toBe("甲乙丙");
    click("取消块多选");
    expect(getMultiSelectedBlocks(editor)).toEqual([]);
  });
  function clickText(text: string) {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === text)!;
    expect(button).toBeTruthy();
    act(() => button.click());
  }

  it("offers bulk heading conversion through the shared popover and undo", () => {
    click("转换成"); clickText("标题 2");
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(1).attrs.level).toBe(2);
    expect(getMultiSelectedBlocks(editor)).toEqual([0, 3]);
    act(() => { editor.commands.undo(); });
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
  });

  it("offers named color swatches and applies background to every selected block", () => {
    click("颜色"); click("背景颜色：蓝色背景");
    expect(editor.state.doc.child(0).attrs.backgroundColor).toBe("rgba(51,126,169,.14)");
    expect(editor.state.doc.child(1).attrs.backgroundColor).toBe("rgba(51,126,169,.14)");
    act(() => { editor.commands.undo(); });
    expect(editor.state.doc.child(0).attrs.backgroundColor).toBeNull();
  });

  it("moves the whole group and recomputes boundaries when the count stays the same", () => {
    act(() => setMultiSelectedBlocks(editor, [3, 6]));
    click("上移多选块");
    expect(editor.state.doc.textContent).toBe("乙丙甲");
    expect(getMultiSelectedBlocks(editor)).toEqual([0, 3]);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="上移多选块"]')!.disabled).toBe(true);
    act(() => { editor.commands.undo(); });
    expect(editor.state.doc.textContent).toBe("甲乙丙");
  });

  it("disables group movement and wrapping for disjoint selections with an explanation", () => {
    act(() => setMultiSelectedBlocks(editor, [0, 6]));
    for (const name of ["上移多选块", "下移多选块", "包裹"]) {
      const button = container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
      expect(button.disabled).toBe(true); expect(button.title).toContain("连续");
    }
  });

  it("wraps the selected paragraphs into one callout through the menu", () => {
    click("包裹"); clickText("标注");
    expect(editor.state.doc.firstChild!.type.name).toBe("callout");
    expect(editor.state.doc.firstChild!.textContent).toBe("甲乙");
    expect(getMultiSelectedBlocks(editor)).toEqual([0]);
    act(() => { editor.commands.undo(); });
    expect(editor.state.doc.textContent).toBe("甲乙丙");
  });

  it("disables all new mutation controls in readonly mode", () => {
    act(() => editor.setEditable(false));
    for (const name of ["转换成", "颜色", "上移多选块", "下移多选块", "包裹"]) {
      expect(container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.disabled).toBe(true);
    }
    expect(container.querySelector<HTMLButtonElement>('[aria-label="取消块多选"]')!.disabled).toBe(false);
  });

});
