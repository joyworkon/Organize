// @vitest-environment jsdom
/**
 * TaskItemToggleGuard（072 匿名可编辑公开链接）：
 * 本端 taskItem 勾选被拦截；输入文字照常；远端同步事务（y-sync$ meta）照常应用。
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { describe, expect, it } from "vitest";
import { TaskItemToggleGuard } from "./task-item-toggle-guard";

const TASK_DOC = {
  type: "doc",
  content: [
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "待办甲" }] }],
        },
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "待办乙" }] }],
        },
      ],
    },
  ],
};

function taskCheckedList(editor: Editor): boolean[] {
  const seq: boolean[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "taskItem") seq.push(!!node.attrs.checked);
  });
  return seq;
}

function createEditor(enabled: boolean) {
  return new Editor({
    content: TASK_DOC,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskItemToggleGuard.configure({ enabled }),
    ],
  });
}

describe("TaskItemToggleGuard", () => {
  it("blocks local checkbox toggles when enabled", () => {
    const editor = createEditor(true);
    editor.commands.command(({ tr }) => {
      let pos = 0;
      editor.state.doc.descendants((node, nodePos) => {
        if (node.type.name === "taskItem" && pos === 0) pos = nodePos;
      });
      tr.setNodeMarkup(pos, undefined, { checked: true });
      return true;
    });
    expect(taskCheckedList(editor)).toEqual([false, true]);
    editor.destroy();
  });

  it("still allows plain text edits when enabled", () => {
    const editor = createEditor(true);
    editor.commands.insertContentAt(5, "新字");
    expect(editor.state.doc.textContent).toContain("待办新字甲");
    expect(taskCheckedList(editor)).toEqual([false, true]);
    editor.destroy();
  });

  it("lets remote (y-sync$) transactions toggle checked through", () => {
    const editor = createEditor(true);
    editor.commands.command(({ tr }) => {
      let pos = 0;
      editor.state.doc.descendants((node, nodePos) => {
        if (node.type.name === "taskItem" && pos === 0) pos = nodePos;
      });
      tr.setNodeMarkup(pos, undefined, { checked: true });
      tr.setMeta("y-sync$", {});
      return true;
    });
    expect(taskCheckedList(editor)).toEqual([true, true]);
    editor.destroy();
  });

  it("does nothing when disabled", () => {
    const editor = createEditor(false);
    editor.commands.command(({ tr }) => {
      let pos = 0;
      editor.state.doc.descendants((node, nodePos) => {
        if (node.type.name === "taskItem" && pos === 0) pos = nodePos;
      });
      tr.setNodeMarkup(pos, undefined, { checked: true });
      return true;
    });
    expect(taskCheckedList(editor)).toEqual([true, true]);
    editor.destroy();
  });
});
