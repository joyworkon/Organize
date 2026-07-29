// @vitest-environment jsdom
/**
 * 拖拽块多选（BlockMultiSelect）测试：
 * 选中块位置集合的装饰、Backspace/Delete 批量删除、Escape 清空、编辑后自动清空。
 * 位置而不是块 id 作为 key：顶层列表（bulletList 等）自身没有 id，用 id 会漏选。
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { describe, expect, it } from "vitest";
import {
  BlockMultiSelect,
  calculateBlockSelectionBounds,
  getMultiSelectedBlocks,
  pointIsInsideBlockSelectionBounds,
  setMultiSelectedBlocks,
} from "./block-multi-select";

function createEditor() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      BlockMultiSelect,
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "甲" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "丙" }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "丁" }] },
      ],
    },
  });
}

/** 顶层块的位置列表（bulletList/taskList 没有块 id，位置才是稳定标识） */
function blockPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.forEach((_node, offset) => positions.push(offset));
  return positions;
}

/** someProp 只在返回值 truthy 时短路：处理过返回 true，未处理一律是 undefined */
function pressKey(editor: Editor, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  return editor.view.someProp("handleKeyDown", (fn) => fn(editor.view, event));
}

describe("BlockMultiSelect 拖拽块多选", () => {
  it("框选边界横向扩展到笔记主画布，纵向仍限制在编辑器内", () => {
    const bounds = calculateBlockSelectionBounds(
      { left: 376, right: 1144, top: 200, bottom: 700 },
      { left: 240, right: 1280, top: 0, bottom: 900 },
      24,
      24
    );
    expect(bounds).toEqual({ left: 264, right: 1256, top: 200, bottom: 700 });
    expect(pointIsInsideBlockSelectionBounds(bounds, 263, 300)).toBe(false);
    expect(pointIsInsideBlockSelectionBounds(bounds, 264, 300)).toBe(true);
    expect(pointIsInsideBlockSelectionBounds(bounds, 1256, 300)).toBe(true);
    expect(pointIsInsideBlockSelectionBounds(bounds, 1257, 300)).toBe(false);
    expect(pointIsInsideBlockSelectionBounds(bounds, 500, 701)).toBe(false);
  });

  it("移动端画布与编辑器同宽时不会把框选范围扩到页面外", () => {
    const bounds = calculateBlockSelectionBounds(
      { left: 16, right: 360, top: 80, bottom: 640 },
      { left: 0, right: 376, top: 0, bottom: 700 },
      16,
      16
    );
    expect(bounds.left).toBe(16);
    expect(bounds.right).toBe(360);
    expect(pointIsInsideBlockSelectionBounds(bounds, 15, 200)).toBe(false);
    expect(pointIsInsideBlockSelectionBounds(bounds, 16, 200)).toBe(true);
  });

  it("设置选中后可以通过 getMultiSelectedBlocks 读到", () => {
    const editor = createEditor();
    const [first, , third] = blockPositions(editor);
    setMultiSelectedBlocks(editor, [first, third]);
    expect(new Set(getMultiSelectedBlocks(editor))).toEqual(new Set([first, third]));
    editor.destroy();
  });

  it("Backspace 删除所有选中块（含没有块 id 的列表），未选中的保留", () => {
    const editor = createEditor();
    const [para, bullet, task] = blockPositions(editor);
    setMultiSelectedBlocks(editor, [para, bullet, task]);
    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe("丁");
    // 删除后多选被清空
    expect(getMultiSelectedBlocks(editor)).toEqual([]);
    editor.destroy();
  });

  it("全部选中删除后文档保留一个空段落", () => {
    const editor = createEditor();
    setMultiSelectedBlocks(editor, blockPositions(editor));
    expect(pressKey(editor, "Delete")).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(editor.state.doc.textContent).toBe("");
    editor.destroy();
  });

  it("Escape 清空多选，不删内容", () => {
    const editor = createEditor();
    setMultiSelectedBlocks(editor, blockPositions(editor).slice(0, 2));
    expect(pressKey(editor, "Escape")).toBe(true);
    expect(getMultiSelectedBlocks(editor)).toEqual([]);
    expect(editor.state.doc.childCount).toBe(4);
    editor.destroy();
  });

  it("没有多选时 Backspace / Escape 不拦截", () => {
    const editor = createEditor();
    expect(pressKey(editor, "Escape")).not.toBe(true);
    editor.destroy();
  });

  it("文档编辑后多选自动清空", () => {
    const editor = createEditor();
    setMultiSelectedBlocks(editor, blockPositions(editor).slice(0, 1));
    editor.commands.insertContent("新内容");
    expect(getMultiSelectedBlocks(editor)).toEqual([]);
    editor.destroy();
  });
});
