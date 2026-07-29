// @vitest-environment jsdom
/**
 * 块首退格行为测试（ListBackspaceFix）：
 * 结构块最前面按 Backspace 应先退化为普通段落（光标原地不动），
 * 而不是把内容合并进上一块导致光标上下串动。
 */
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import { describe, expect, it } from "vitest";
import { Callout } from "./callout";
import { ListBackspaceFix } from "./list-backspace";

function createEditor(content: JSONContent) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Details,
      DetailsContent,
      DetailsSummary,
      Callout,
      ListBackspaceFix,
    ],
    content,
  });
  return editor;
}

/** 把光标放到指定 nodeType 第一个出现的文本起始处 */
function focusStartOf(editor: Editor, typeName: string): boolean {
  let textPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (textPos !== null) return false;
    if (node.type.name === typeName) {
      // 找到该块内第一个文本位置
      node.descendants((child, childPos) => {
        if (textPos !== null) return false;
        if (child.isText || child.isTextblock) {
          textPos = pos + 1 + childPos + (child.isText ? 0 : 1);
          return false;
        }
        return true;
      });
    }
    return true;
  });
  if (textPos === null) return false;
  editor.commands.setTextSelection(textPos);
  return true;
}

function pressBackspace(editor: Editor) {
  const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  const handled = editor.view.someProp("handleKeyDown", (fn) => fn(editor.view, event));
  return handled;
}

function typeNames(editor: Editor): string[] {
  const names: string[] = [];
  editor.state.doc.forEach((node) => names.push(node.type.name));
  return names;
}

describe("ListBackspaceFix 块首退格", () => {
  it("项目符号列表项：先抬回普通段落，光标原地不动", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "列表项" }] }] }] },
      ],
    });
    expect(focusStartOf(editor, "listItem")).toBe(true);
    const handled = pressBackspace(editor);
    expect(handled).toBe(true);
    expect(typeNames(editor)).toEqual(["paragraph", "paragraph"]);
    expect(editor.state.doc.textContent).toContain("列表项");
    expect(editor.state.doc.textContent).toContain("上一行");
    // 光标仍在「列表项」文字前面，没有跳走
    expect(editor.state.selection.$from.parent.textContent).toBe("列表项");
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    editor.destroy();
  });

  it("待办列表项：先抬回普通段落", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "待办" }] }] }] },
      ],
    });
    expect(focusStartOf(editor, "taskItem")).toBe(true);
    expect(pressBackspace(editor)).toBe(true);
    expect(typeNames(editor)).toEqual(["paragraph", "paragraph"]);
    expect(editor.state.doc.textContent).toContain("待办");
    editor.destroy();
  });

  it("引用：段落从包裹中抬出，光标原地不动", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用内容" }] }] },
      ],
    });
    expect(focusStartOf(editor, "blockquote")).toBe(true);
    expect(pressBackspace(editor)).toBe(true);
    expect(typeNames(editor)).toEqual(["paragraph", "paragraph"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("引用内容");
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    editor.destroy();
  });

  it("标注：段落从包裹中抬出", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
        { type: "callout", attrs: { emoji: "💡" }, content: [{ type: "paragraph", content: [{ type: "text", text: "标注内容" }] }] },
      ],
    });
    expect(focusStartOf(editor, "callout")).toBe(true);
    expect(pressBackspace(editor)).toBe(true);
    expect(typeNames(editor)).toEqual(["paragraph", "paragraph"]);
    expect(editor.state.doc.textContent).toContain("标注内容");
    editor.destroy();
  });

  it("代码块：归一化为段落", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
        { type: "codeBlock", content: [{ type: "text", text: "const a = 1;" }] },
      ],
    });
    expect(focusStartOf(editor, "codeBlock")).toBe(true);
    expect(pressBackspace(editor)).toBe(true);
    expect(typeNames(editor)).toEqual(["paragraph", "paragraph"]);
    expect(editor.state.doc.textContent).toContain("const a = 1;");
    editor.destroy();
  });

  it("标题：归一化为段落，光标不跳走", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题" }] },
      ],
    });
    expect(focusStartOf(editor, "heading")).toBe(true);
    expect(pressBackspace(editor)).toBe(true);
    expect(typeNames(editor)).toEqual(["paragraph", "paragraph"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("标题");
    editor.destroy();
  });

  it("折叠列表：整块展开为段落 + 内容块", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
        {
          type: "details",
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "折叠标题" }] },
            { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "折叠内容" }] }] },
          ],
        },
      ],
    });
    expect(focusStartOf(editor, "detailsSummary")).toBe(true);
    expect(pressBackspace(editor)).toBe(true);
    expect(typeNames(editor)).toEqual(["paragraph", "paragraph", "paragraph"]);
    const text = editor.state.doc.textContent;
    expect(text).toContain("折叠标题");
    expect(text).toContain("折叠内容");
    editor.destroy();
  });

  it("折叠列表：摘要行的加粗/链接等行内格式展开后保留", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "details",
          content: [
            {
              type: "detailsSummary",
              content: [
                { type: "text", text: "普通" },
                { type: "text", marks: [{ type: "bold" }], text: "加粗" },
              ],
            },
            { type: "detailsContent", content: [{ type: "paragraph" }] },
          ],
        },
      ],
    });
    expect(focusStartOf(editor, "detailsSummary")).toBe(true);
    expect(pressBackspace(editor)).toBe(true);
    const first = editor.state.doc.child(0);
    expect(first.type.name).toBe("paragraph");
    // 加粗 mark 必须保留
    let hasBold = false;
    first.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "bold")) hasBold = true;
      return true;
    });
    expect(hasBold).toBe(true);
    editor.destroy();
  });

  it("普通段落首行退格：不拦截（保持默认合并行为）", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上一行" }] },
        { type: "paragraph", content: [{ type: "text", text: "第二行" }] },
      ],
    });
    expect(focusStartOf(editor, "paragraph")).toBe(true);
    // focusStartOf 找到的是第一个段落（上一行），其前面没有块，默认退格无操作即可；
    // 这里主要验证我们的扩展不误拦截。
    pressBackspace(editor);
    expect(typeNames(editor)).toEqual(["paragraph", "paragraph"]);
    editor.destroy();
  });

  it("列表项中间位置退格：不拦截", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "列表项" }] }] }] },
      ],
    });
    expect(focusStartOf(editor, "listItem")).toBe(true);
    // 光标右移一位（不在块首）
    editor.commands.setTextSelection(editor.state.selection.from + 1);
    pressBackspace(editor);
    // 我们的扩展不拦截：列表结构与文字保持原样
    // （默认的删除字符行为由浏览器执行，jsdom 不模拟，故只验证未被拦截）
    expect(typeNames(editor)).toEqual(["bulletList"]);
    expect(editor.state.doc.textContent).toBe("列表项");
    editor.destroy();
  });
});
