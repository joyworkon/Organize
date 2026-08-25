// @vitest-environment jsdom
/**
 * 页面内块搜索（E7）核心逻辑测试：
 * - 命中粒度是 textblock（段落/标题/列表项/代码块/表格单元格）；
 * - 容器块（callout）不重复计入，其内部段落单独命中；
 * - 大小写不敏感；每块只列一次；空查询与无命中返回空；limit 生效。
 */
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import UniqueID from "@tiptap/extension-unique-id";
import { describe, expect, it } from "vitest";
import { Callout } from "./extensions/callout";
import { buildSnippet, searchTextBlocks } from "./note-search-dialog";

function createEditor(content: JSONContent) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Table,
      TableRow,
      TableCell,
      TableHeader,
      Callout,
      // 与真实编辑器一致：块带 id 属性（BLOCK_ID_TYPES 核心类型）
      UniqueID.configure({ types: ["paragraph", "heading", "codeBlock"] }),
    ],
    content,
  });
}

const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "季度 OKR Review 复盘" }] },
    { type: "paragraph", content: [{ type: "text", text: "本季度完成度 Review 很高。" }] },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "review 频率保持每周一次" }] }] },
      ],
    },
    { type: "codeBlock", content: [{ type: "text", text: "git review --stat" }] },
    {
      type: "callout",
      attrs: { emoji: "💡", color: "blue" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "复盘要点：REVIEW 是关键动作" }] }],
    },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "周期性 review" }] }] },
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "无关节点" }] }] },
        ] },
      ],
    },
  ],
};

describe("searchTextBlocks", () => {
  it("跨块类型命中：标题/段落/列表项/代码块/callout 内段落/表格单元格", () => {
    const editor = createEditor(DOC);
    const hits = searchTextBlocks(editor.state.doc, "review");
    const types = hits.map((hit) => hit.type);
    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
    expect(types).toContain("listItem");
    expect(types).toContain("codeBlock");
    expect(types).toContain("tableCell");
    editor.destroy();
  });

  it("callout 容器不重复计入：内部段落命中一次，callout 自身不计", () => {
    const editor = createEditor(DOC);
    const hits = searchTextBlocks(editor.state.doc, "复盘");
    expect(hits.map((hit) => hit.type)).toEqual(["heading", "paragraph"]);
    editor.destroy();
  });

  it("大小写不敏感", () => {
    const editor = createEditor(DOC);
    expect(searchTextBlocks(editor.state.doc, "OKR")).toHaveLength(1);
    expect(searchTextBlocks(editor.state.doc, "okr")).toHaveLength(1);
    editor.destroy();
  });

  it("同一块内多次出现关键词只列一次，片段取首个命中", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "alpha beta alpha beta alpha" }] },
      ],
    });
    const hits = searchTextBlocks(editor.state.doc, "alpha");
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet.before).toBe("");
    expect(hits[0].snippet.match).toBe("alpha");
    expect(hits[0].snippet.after).toBe(" beta alpha beta alpha");
    editor.destroy();
  });

  it("空查询与无命中返回空数组", () => {
    const editor = createEditor(DOC);
    expect(searchTextBlocks(editor.state.doc, "")).toEqual([]);
    expect(searchTextBlocks(editor.state.doc, "   ")).toEqual([]);
    expect(searchTextBlocks(editor.state.doc, "不存在的词")).toEqual([]);
    editor.destroy();
  });

  it("命中携带 pos（可定位）与块 id（存在时）", () => {
    const editor = createEditor(DOC);
    const hits = searchTextBlocks(editor.state.doc, "完成度");
    expect(hits).toHaveLength(1);
    expect(hits[0].pos).toBeGreaterThan(0);
    expect(typeof hits[0].type).toBe("string");
    editor.destroy();
  });

  it("limit 截断结果数量", () => {
    const editor = createEditor({
      type: "doc",
      content: Array.from({ length: 10 }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: `关键词 第${i}段` }],
      })),
    });
    expect(searchTextBlocks(editor.state.doc, "关键词", 3)).toHaveLength(3);
    editor.destroy();
  });

  it("块 id 属性被读取（有 id 的块返回 id）", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "blk-1" }, content: [{ type: "text", text: "目标文本" }] },
      ],
    });
    const hits = searchTextBlocks(editor.state.doc, "目标");
    expect(hits[0].id).toBe("blk-1");
    editor.destroy();
  });
});

describe("buildSnippet", () => {
  it("长文本按半径截取上下文", () => {
    const text = "A".repeat(40) + "目标" + "B".repeat(40);
    const snippet = buildSnippet(text, 40, 2);
    expect(snippet.before).toBe("A".repeat(24));
    expect(snippet.match).toBe("目标");
    expect(snippet.after).toBe("B".repeat(24));
  });

  it("命中靠近开头时不产生负索引", () => {
    const snippet = buildSnippet("命中在开头", 0, 2);
    expect(snippet.before).toBe("");
    expect(snippet.match).toBe("命中");
    expect(snippet.after).toBe("在开头");
  });
});
