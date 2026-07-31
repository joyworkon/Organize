// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { UniqueID } from "@tiptap/extension-unique-id";
import { collectTocEntries, normalizeTocLevels, parseTocLevels, serializeTocLevels } from "./toc";
import { TableOfContents } from "./table-of-contents";

function makeEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      UniqueID.configure({ types: ["heading"] }),
      TableOfContents,
    ],
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "概述" }] },
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "细节" }] },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "子项" }] },
        { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "更深层" }] },
      ],
    },
  });
}

describe("normalizeTocLevels", () => {
  it("非法值回退默认 1-3", () => {
    expect(normalizeTocLevels(null)).toEqual([1, 2, 3]);
    expect(normalizeTocLevels([])).toEqual([1, 2, 3]);
    expect(normalizeTocLevels([7, 99])).toEqual([1, 2, 3]);
    expect(normalizeTocLevels("bad")).toEqual([1, 2, 3]);
  });

  it("去重并升序排列", () => {
    expect(normalizeTocLevels([3, 1, 2, 1])).toEqual([1, 2, 3]);
  });
});

describe("serialize / parse levels", () => {
  it("往返保持一致", () => {
    const levels = [2, 3];
    expect(parseTocLevels(serializeTocLevels(levels))).toEqual(levels);
  });
  it("空字符串回退默认", () => {
    expect(parseTocLevels("")).toEqual([1, 2, 3]);
    expect(parseTocLevels(null)).toEqual([1, 2, 3]);
  });
});

describe("collectTocEntries", () => {
  it("默认只收 H1-H3，跳过更深层级与段落", () => {
    const editor = makeEditor();
    const entries = collectTocEntries(editor.state.doc);
    expect(entries.map((e) => e.text)).toEqual(["概述", "细节", "子项"]);
    expect(entries.map((e) => e.level)).toEqual([1, 2, 3]);
    editor.destroy();
  });

  it("可自定义级别范围", () => {
    const editor = makeEditor();
    const entries = collectTocEntries(editor.state.doc, [2, 3, 4]);
    expect(entries.map((e) => e.text)).toEqual(["细节", "子项", "更深层"]);
    editor.destroy();
  });

  it("无标题时返回空数组", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableOfContents],
      content: { type: "doc", content: [{ type: "paragraph", content: [] }] },
    });
    expect(collectTocEntries(editor.state.doc)).toEqual([]);
    editor.destroy();
  });
});

describe("TableOfContents 节点持久化", () => {
  it("渲染并解析 levels 属性", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableOfContents],
      content: {
        type: "doc",
        content: [{ type: "tableOfContents", attrs: { levels: [2, 3] } }],
      },
    });
    const html = editor.getHTML();
    expect(html).toContain("data-toc");
    expect(html).toContain("data-levels");
    const parsed = new Editor({
      extensions: [StarterKit, TableOfContents],
      content: html,
    });
    expect(parsed.getJSON().content?.[0]?.attrs?.levels).toEqual([2, 3]);
    editor.destroy();
    parsed.destroy();
  });

  it("insertTableOfContents 命令插入目录块", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableOfContents],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.insertTableOfContents();
    const json = editor.getJSON();
    expect(json.content?.some((n) => n.type === "tableOfContents")).toBe(true);
    editor.destroy();
  });
});
