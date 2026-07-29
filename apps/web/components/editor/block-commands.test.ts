// @vitest-environment jsdom
/**
 * replaceBlock 的列表合并测试：替换成列表后，前后相邻的同类型列表必须合并，
 * 否则「转换成列表」会造出两个紧挨着却各自独立的列表（渲染成两段、编号断裂）。
 */
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { describe, expect, it } from "vitest";
import { BLOCK_COMMANDS, replaceBlock } from "./block-commands";
import { Columns, Column } from "./extensions/columns";

function createEditor(content: JSONContent) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Columns,
      Column,
    ],
    content,
  });
}

function topLevelPosOf(editor: Editor, predicate: (text: string) => boolean): number {
  let found = -1;
  editor.state.doc.forEach((node, offset) => {
    if (found < 0 && predicate(node.textContent)) found = offset;
  });
  return found;
}

describe("replaceBlock 相邻同类列表合并", () => {
  it("段落转换成项目符号列表：与前后已有列表合并为一个", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "上" }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "转换我" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "下" }] }] }] },
      ],
    });
    const pos = topLevelPosOf(editor, (text) => text.includes("转换我"));
    const command = BLOCK_COMMANDS.find((item) => item.id === "bullet-list")!;
    command.run(editor, pos);
    expect(editor.state.doc.childCount).toBe(1);
    const list = editor.state.doc.firstChild!;
    expect(list.type.name).toBe("bulletList");
    expect(list.childCount).toBe(3);
    expect(list.textContent).toBe("上转换我下");
    editor.destroy();
  });

  it("只与前一个列表相邻：合并；类型不同不合并", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "编号" }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "转换我" }] },
      ],
    });
    const pos = topLevelPosOf(editor, (text) => text.includes("转换我"));
    // 转成项目符号列表：与 orderedList 类型不同，不合并
    BLOCK_COMMANDS.find((item) => item.id === "bullet-list")!.run(editor, pos);
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(0).type.name).toBe("orderedList");
    expect(editor.state.doc.child(1).type.name).toBe("bulletList");
    editor.destroy();
  });

  it("待办列表之间转换：同类型合并", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "上" }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "转换我" }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "下" }] }] }] },
      ],
    });
    const pos = topLevelPosOf(editor, (text) => text.includes("转换我"));
    BLOCK_COMMANDS.find((item) => item.id === "task-list")!.run(editor, pos);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.type.name).toBe("taskList");
    expect(editor.state.doc.firstChild!.childCount).toBe(3);
    editor.destroy();
  });

  it("非列表替换不受影响", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "甲" }] },
        { type: "paragraph", content: [{ type: "text", text: "乙" }] },
      ],
    });
    const pos = topLevelPosOf(editor, (text) => text.includes("乙"));
    replaceBlock(editor, pos, { type: "heading", attrs: { level: 2 }, content: [] });
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(1).type.name).toBe("heading");
    editor.destroy();
  });

  it("转换成 2 列：原文本进入第一列", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "栏里的文字" }] }],
    });
    const pos = topLevelPosOf(editor, (text) => text.includes("栏里的文字"));
    BLOCK_COMMANDS.find((item) => item.id === "columns-2")!.run(editor, pos);
    const columns = editor.state.doc.firstChild!;
    expect(columns.type.name).toBe("columns");
    expect(columns.attrs.cols).toBe(2);
    expect(columns.childCount).toBe(2);
    expect(columns.child(0).textContent).toBe("栏里的文字");
    expect(columns.child(1).textContent).toBe("");
    editor.destroy();
  });

  it("转换成 5 列：创建 5 个列", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }],
    });
    const pos = topLevelPosOf(editor, (text) => text.includes("甲"));
    const command = BLOCK_COMMANDS.find((item) => item.id === "columns-5");
    expect(command).toBeDefined();
    command!.run(editor, pos);
    const columns = editor.state.doc.firstChild!;
    expect(columns.type.name).toBe("columns");
    expect(columns.attrs.cols).toBe(5);
    expect(columns.childCount).toBe(5);
    editor.destroy();
  });
});
