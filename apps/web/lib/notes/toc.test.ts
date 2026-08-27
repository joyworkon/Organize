import { describe, expect, it } from "vitest";
import {
  buildTocTree,
  collapsibleKeys,
  extractTocItems,
  flattenTocTree,
  tocKey,
} from "./toc";

const doc = (content: unknown[]) => ({ type: "doc", content });
const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("extractTocItems", () => {
  it("提取 1-3 级标题并记录顶层块索引", () => {
    const content = doc([
      paragraph("intro"),
      heading(1, "一"),
      heading(2, "一点一"),
      heading(4, "忽略四级"),
      heading(3, "一点一点一"),
    ]);
    const items = extractTocItems(content);
    expect(items.map((i) => [i.text, i.level, i.blockIndex])).toEqual([
      ["一", 1, 1],
      ["一点一", 2, 2],
      ["一点一点一", 3, 4],
    ]);
  });

  it("空文本标题被跳过", () => {
    const items = extractTocItems(doc([heading(1, "   "), paragraph("x")]));
    expect(items).toEqual([]);
  });

  it("details/syncedBlock 内的标题标记 inCollapsed", () => {
    const content = doc([
      heading(1, "外层"),
      {
        type: "details",
        content: [heading(2, "折叠内")],
      },
      {
        type: "syncedBlock",
        content: [heading(2, "同步内")],
      },
    ]);
    const items = extractTocItems(content);
    expect(items.find((i) => i.text === "外层")?.inCollapsed).toBe(false);
    expect(items.find((i) => i.text === "折叠内")?.inCollapsed).toBe(true);
    expect(items.find((i) => i.text === "同步内")?.inCollapsed).toBe(true);
  });

  it("非法输入返回空数组", () => {
    expect(extractTocItems(null)).toEqual([]);
    expect(extractTocItems({})).toEqual([]);
    expect(extractTocItems({ type: "doc" })).toEqual([]);
  });
});

describe("buildTocTree / flattenTocTree", () => {
  it("按层级组装树并保留越级归位", () => {
    const items = extractTocItems(
      doc([heading(1, "A"), heading(3, "A-x"), heading(2, "A-2"), heading(1, "B")])
    );
    const tree = buildTocTree(items);
    expect(tree.map((n) => n.text)).toEqual(["A", "B"]);
    expect(tree[0].children.map((n) => n.text)).toEqual(["A-x", "A-2"]);

    const flat = flattenTocTree(tree);
    expect(flat.map((f) => [f.item.text, f.depth, f.hasChildren])).toEqual([
      ["A", 0, true],
      ["A-x", 1, false],
      ["A-2", 1, false],
      ["B", 0, false],
    ]);
  });
});

describe("collapsibleKeys", () => {
  it("只收集有子级的节点", () => {
    const items = extractTocItems(
      doc([heading(1, "A"), heading(2, "A-1"), heading(1, "B")])
    );
    const tree = buildTocTree(items);
    expect(collapsibleKeys(tree)).toEqual([tocKey({ text: "A", level: 1, blockIndex: 0, inCollapsed: false })]);
  });
});
