import { describe, expect, it } from "vitest";
import { findCanvasContent } from "./board-find";
import { createBoardShape, createButtonBlock, createDividerBlock, createEmbedBlock, createImageBlock, createMaterialCardBlock, createTextBlock, emptyDoc, type CanvasDoc } from "./model";

function fixture(): CanvasDoc {
  let n = 0;
  const id = () => `id-${++n}`;
  const board = createBoardShape({ x: 0, y: 0 }, id);
  board.name = "ALPHA 页面";
  board.regions[0].name = "alpha 区块";
  board.regions[0].sections[0].columns[0].blocks = [
    createTextBlock("title", "Alpha Alpha", id),
    createTextBlock("list", "第一项\nalpha 第二项", id),
    { ...createButtonBlock(id), label: "alpha 按钮", href: "https://ignored.invalid" },
    createMaterialCardBlock({ title: "不是检索字段", text: "alpha 摘录", sourceRef: { kind: "memo", id: "source", title: "source" } }, id),
    createEmbedBlock("https://ignored.invalid", { title: "alpha 链接" }, id),
    { ...createImageBlock(null, id), alt: "alpha 不搜图片" },
    createDividerBlock(id),
  ];
  return {
    ...emptyDoc(), boards: [board, { ...createBoardShape({ x: 900, y: 0 }, id), name: "alpha 第二页" }],
    freeItems: [
      { id: id(), x: 0, y: 500, width: 200, zIndex: 0, block: createTextBlock("body", "alpha 自由文本", id) },
      { id: id(), x: 400, y: 500, width: 200, zIndex: 1, block: { ...createTextBlock("body", "alpha 便签", id), style: { background: "yellow" } } },
      { id: id(), x: 600, y: 500, width: 200, zIndex: 2, block: { id: id(), type: "shape", kind: "rect", height: 100 } },
    ],
    connectors: [{ id: id(), from: "a", to: "b", label: "alpha 关系", arrow: "end", line: "solid", color: "" }],
  };
}

describe("findCanvasContent", () => {
  it("按文档顺序搜索各类型，每对象仅首命中，并返回完整块坐标", () => {
    const doc = fixture();
    const original = structuredClone(doc);
    const hits = findCanvasContent(doc, "  alpha  ");
    expect(hits.map((hit) => hit.kind)).toEqual(["board", "region", "block", "block", "block", "block", "block", "board", "free", "free", "connector"]);
    const board = doc.boards[0], region = board.regions[0], section = region.sections[0], column = section.columns[0];
    expect(hits[2].target).toEqual({ kind: "block", boardId: board.id, regionId: region.id, sectionId: section.id, columnId: column.id, blockId: column.blocks[0].id });
    expect(hits[2].snippet).toEqual({ before: "", match: "Alpha", after: " Alpha" });
    expect(hits[8].target).toEqual({ kind: "free", itemId: doc.freeItems[0].id });
    expect(hits[10].target).toEqual({ kind: "connector", connectorId: doc.connectors![0].id });
    expect(doc).toEqual(original);
  });
  it("空白、零命中、旧文档无连接线、零上限", () => {
    const doc = fixture();
    delete doc.connectors;
    for (const q of ["", "  \n", "不存在", "ignored.invalid", "不是检索字段", "source"]) expect(findCanvasContent(doc, q)).toEqual([]);
    expect(findCanvasContent(doc, "alpha", 0)).toEqual([]);
    expect(findCanvasContent(doc, "alpha", -1)).toEqual([]);
    expect(findCanvasContent(doc, "alpha", 3)).toHaveLength(3);
  });
  it("按字面量匹配特殊字符，片段前后各 24 字", () => {
    const doc = fixture();
    doc.boards[0].name = "前".repeat(30) + "[A.*](x)?\\$" + "后".repeat(30);
    expect(findCanvasContent(doc, "[a.*](x)?\\$")[0].snippet).toEqual({ before: "前".repeat(24), match: "[A.*](x)?\\$", after: "后".repeat(24) });
    expect(findCanvasContent(doc, "a.*")).toHaveLength(1);
  });
  it("默认最多 100 个，结果稳定", () => {
    const doc = emptyDoc();
    doc.freeItems = Array.from({ length: 120 }, (_, i) => ({ id: `free-${i}`, x: i * 10, y: 0, width: 200, zIndex: i, block: createTextBlock("body", "查找", () => `block-${i}`) }));
    expect(findCanvasContent(doc, "查找")).toHaveLength(100);
    expect(findCanvasContent(doc, "查找")[99].id).toBe("free-99");
    expect(findCanvasContent(doc, "查找")).toEqual(findCanvasContent(doc, "查找"));
  });
});
