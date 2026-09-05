// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import { describe, expect, it } from "vitest";
import {
  BLOCK_COMMANDS,
  NESTED_EMIT_COMMANDS,
  executeNestedCommand,
  isCommandAvailableInContext,
} from "./block-commands";
import { Callout } from "./extensions/callout";

/** 嵌套上下文有真实执行路径的命令 id（executeNestedCommand 的 insert 分支 ∪ 嵌套 emit 路径） */
const NESTED_INSERT_HANDLED = new Set([
  "paragraph",
  "heading-1",
  "heading-2",
  "heading-3",
  "heading-4",
  "toggle-heading-1",
  "toggle-heading-2",
  "toggle-heading-3",
  "toggle-heading-4",
  "bullet-list",
  "ordered-list",
  "task-list",
  "details",
  "quote",
  "code",
  "callout",
  "divider",
]);

function createEditor(content: any) {
  return new Editor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem,
      Details,
      DetailsContent,
      DetailsSummary,
      Callout,
    ],
    content,
  });
}

describe("R06 命令能力一致性", () => {
  it("嵌套菜单显示的命令必须有真实执行路径（隐藏 ⇔ 无路径，二者不多不少）", () => {
    for (const command of BLOCK_COMMANDS) {
      const shown = isCommandAvailableInContext(command, true);
      const hasPath =
        NESTED_INSERT_HANDLED.has(command.id)
        || (NESTED_EMIT_COMMANDS as readonly string[]).includes(command.id);
      expect({ id: command.id, shown, hasPath }).toEqual({
        id: command.id,
        shown: hasPath,
        hasPath,
      });
    }
  });

  it("顶层菜单显示所有内置命令", () => {
    for (const command of BLOCK_COMMANDS) {
      expect(isCommandAvailableInContext(command, false)).toBe(true);
    }
  });

  it("unsupported 时不动文档：触发文本保留、无内容插入", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "/tabs" }] }],
        },
      ],
    });
    // "/tabs" 在 blockquote 段落内：pos 1 开始
    const range = { from: 2, to: 6 };
    const result = executeNestedCommand(editor, "tabs", range);
    expect(result).toBe("unsupported");
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
    expect(text).toContain("/tabs");
    editor.destroy();
  });

  it("handled：嵌套引用内插入分隔线并消费触发文本", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "/div" }] }],
        },
      ],
    });
    const range = { from: 2, to: 5 };
    const result = executeNestedCommand(editor, "divider", range);
    expect(result).toBe("handled");
    const quote = editor.state.doc.nodeAt(0);
    expect(quote?.type.name).toBe("blockquote");
    expect(quote?.content?.childCount).toBeGreaterThan(0);
    // 触发文本已被消费
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
    expect(text).not.toContain("/div");
    editor.destroy();
  });

  it("handled：嵌套引用内插入待办列表（taskItem 结构完整）", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "/todo" }] }],
        },
      ],
    });
    const range = { from: 2, to: 7 };
    const result = executeNestedCommand(editor, "task-list", range);
    expect(result).toBe("handled");
    const json = editor.getJSON().content?.[0] as any;
    const list = JSON.stringify(json);
    expect(list).toContain("taskList");
    expect(list).not.toContain("/todo");
    editor.destroy();
  });
});
