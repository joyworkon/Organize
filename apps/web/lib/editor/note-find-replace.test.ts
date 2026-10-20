// @vitest-environment jsdom
/**
 * 页内替换：只改 textblock 文本，保留块 id / 类型；大小写不敏感；空查询不动文档。
 */
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import { describe, expect, it } from "vitest";
import { Callout } from "@/components/editor/extensions/callout";
import { applyReplaceAll, applyReplaceAtHit, replaceFirstInText, searchTextBlocks } from "./note-find-replace";

function createEditor(content: JSONContent, editable = true) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Callout,
      UniqueID.configure({ types: ["paragraph", "heading", "codeBlock"] }),
    ],
    content,
    editable,
  });
}

function blockCount(doc: ProseMirrorNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.isBlock) count += 1;
  });
  return count;
}

function idsOf(doc: ProseMirrorNode): Record<string, { type: string; text: string }> {
  const ids: Record<string, { type: string; text: string }> = {};
  doc.descendants((node) => {
    const id = node.attrs?.id;
    if (typeof id === "string") ids[id] = { type: node.type.name, text: node.textContent };
  });
  return ids;
}

const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { id: "h1", level: 1 }, content: [{ type: "text", text: "Review notes" }] },
    { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Please review this review." }] },
    { type: "codeBlock", attrs: { id: "c1" }, content: [{ type: "text", text: "review()" }] },
    {
      type: "callout",
      attrs: { emoji: "💡", color: "blue" },
      content: [{ type: "paragraph", attrs: { id: "p-callout" }, content: [{ type: "text", text: "inner REVIEW" }] }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", attrs: { id: "p-li" }, content: [{ type: "text", text: "weekly review" }] }],
        },
      ],
    },
  ],
};

describe("replaceFirstInText", () => {
  it("大小写不敏感，只用 replacement 原文覆盖首个匹配", () => {
    expect(replaceFirstInText("Hello Review", "review", "OK")).toEqual({ next: "Hello OK", did: true });
    expect(replaceFirstInText("Alpha alpha", "ALPHA", "X")).toEqual({ next: "X alpha", did: true });
  });

  it("查询里的正则字符按字面量匹配", () => {
    expect(replaceFirstInText("price is 1.5", ".", "X")).toEqual({ next: "price is 1X5", did: true });
    expect(replaceFirstInText("review()", "()", "[]")).toEqual({ next: "review[]", did: true });
  });

  it("空查询、空白查询、无命中不改文本", () => {
    expect(replaceFirstInText("abc", "", "x")).toEqual({ next: "abc", did: false });
    expect(replaceFirstInText("abc", "   ", "x")).toEqual({ next: "abc", did: false });
    expect(replaceFirstInText("abc", "z", "Q")).toEqual({ next: "abc", did: false });
  });

  it("空 replacement 删掉首个匹配", () => {
    expect(replaceFirstInText("foo bar", "foo", "")).toEqual({ next: " bar", did: true });
  });

  it("trim 后的查询与搜索一致", () => {
    expect(replaceFirstInText("see review", "  review  ", "检查")).toEqual({ next: "see 检查", did: true });
  });
});

describe("applyReplaceAll / applyReplaceAtHit", () => {
  it("全部替换只改文本，heading / paragraph / codeBlock id 与块数量不变", () => {
    const editor = createEditor(DOC);
    const beforeIds = idsOf(editor.state.doc);
    const beforeBlocks = blockCount(editor.state.doc);
    const count = applyReplaceAll(editor, "review", "检查");
    expect(count).toBe(5);
    const afterIds = idsOf(editor.state.doc);
    expect(Object.keys(afterIds).sort()).toEqual(Object.keys(beforeIds).sort());
    expect(afterIds.h1).toEqual({ type: "heading", text: "检查 notes" });
    expect(afterIds.p1).toEqual({ type: "paragraph", text: "Please 检查 this review." });
    expect(afterIds.c1).toEqual({ type: "codeBlock", text: "检查()" });
    expect(afterIds["p-callout"]).toEqual({ type: "paragraph", text: "inner 检查" });
    expect(afterIds["p-li"]).toEqual({ type: "paragraph", text: "weekly 检查" });
    expect(blockCount(editor.state.doc)).toBe(beforeBlocks);
    const heading = editor.state.doc.firstChild;
    expect(heading?.type.name).toBe("heading");
    expect(heading?.attrs.level).toBe(1);
    expect(heading?.attrs.id).toBe("h1");
    const callout = editor.state.doc.child(3);
    expect(callout.type.name).toBe("callout");
    expect(callout.attrs.emoji).toBe("💡");
    expect(editor.state.doc.child(4).type.name).toBe("bulletList");
    editor.destroy();
  });

  it("单处替换后块 id 仍在，且只动当前 textblock 的首个匹配", () => {
    const editor = createEditor(DOC);
    const hits = searchTextBlocks(editor.state.doc, "review");
    const paragraph = hits.find((hit) => hit.id === "p1");
    expect(paragraph).toBeTruthy();
    expect(applyReplaceAtHit(editor, paragraph!, "ReViEw", "OK")).toBe(true);
    const ids = idsOf(editor.state.doc);
    expect(ids.p1).toEqual({ type: "paragraph", text: "Please OK this review." });
    expect(ids.h1.text).toBe("Review notes");
    expect(ids.c1.text).toBe("review()");
    editor.destroy();
  });

  it("列表项内第二个段落按 textPos 替换，不误伤同一 listItem 的第一段", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", attrs: { id: "li-a" }, content: [{ type: "text", text: "alpha first" }] },
                { type: "paragraph", attrs: { id: "li-b" }, content: [{ type: "text", text: "alpha second" }] },
              ],
            },
          ],
        },
      ],
    });
    const hits = searchTextBlocks(editor.state.doc, "alpha");
    expect(hits).toHaveLength(2);
    expect(hits[0].pos).toBe(hits[1].pos);
    expect(hits[0].textPos).not.toBe(hits[1].textPos);
    expect(applyReplaceAtHit(editor, hits[1], "alpha", "β")).toBe(true);
    const ids = idsOf(editor.state.doc);
    expect(ids["li-a"].text).toBe("alpha first");
    expect(ids["li-b"].text).toBe("β second");
    editor.destroy();
  });

  it("保留匹配起点上父节点允许的 marks", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p-mark" },
          content: [
            { type: "text", text: "please " },
            { type: "text", marks: [{ type: "bold" }], text: "REVIEW" },
            { type: "text", text: " end" },
          ],
        },
      ],
    });
    const [hit] = searchTextBlocks(editor.state.doc, "review");
    expect(applyReplaceAtHit(editor, hit, "review", "OK")).toBe(true);
    expect(editor.state.doc.textContent).toBe("please OK end");
    let boldText = "";
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "bold")) boldText += node.text;
    });
    expect(boldText).toBe("OK");
    expect(idsOf(editor.state.doc)["p-mark"].type).toBe("paragraph");
    editor.destroy();
  });

  it("空 query 不改文档；只读编辑器不能替换", () => {
    const editor = createEditor(DOC);
    const before = editor.getJSON();
    expect(applyReplaceAll(editor, "   ", "x")).toBe(0);
    expect(applyReplaceAll(editor, "", "x")).toBe(0);
    expect(editor.getJSON()).toEqual(before);
    editor.setEditable(false);
    expect(applyReplaceAll(editor, "review", "x")).toBe(0);
    const [hit] = searchTextBlocks(editor.state.doc, "review");
    expect(applyReplaceAtHit(editor, hit, "review", "x")).toBe(false);
    expect(editor.state.doc.textContent).toContain("Review notes");
    expect(editor.state.doc.firstChild?.attrs.id).toBe("h1");
    editor.destroy();
  });

  it("替换串里再包含查询词时只替换一轮，不循环", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { id: "b" }, content: [{ type: "text", text: "a" }] },
      ],
    });
    expect(applyReplaceAll(editor, "a", "a-a")).toBe(2);
    expect(editor.state.doc.textContent).toBe("a-aa-a");
    expect(idsOf(editor.state.doc).a.text).toBe("a-a");
    expect(idsOf(editor.state.doc).b.text).toBe("a-a");
    editor.destroy();
  });
});
