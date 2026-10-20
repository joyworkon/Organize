import { describe, expect, it } from "vitest";
import { createBoardShape, emptyDoc, type CanvasBlock, type CanvasDoc } from "./model";
import { canvasListDto, summarizeCanvas } from "./list-summary";

let seq = 0;
const id = () => `node-${++seq}`;
function withBoard(blocks: CanvasBlock[]): CanvasDoc {
  const board = createBoardShape({ x: -300, y: 200 }, id);
  board.regions[0].sections = [board.regions[0].sections[0]];
  board.regions[0].sections[0].columns[0].blocks = blocks;
  return { ...emptyDoc(), boards: [board] };
}
const text = (value: string): CanvasBlock => ({ id: id(), type: "text", role: "body", text: value });

describe("canvas list summary", () => {
  it("空文档有零计数与空图形，非法/未来文档无摘要", () => {
    expect(summarizeCanvas(emptyDoc())).toEqual({ pages: 0, blocks: 0, excerpt: "", shapes: [] });
    expect(summarizeCanvas(null)).toBeNull();
    expect(summarizeCanvas({ schemaVersion: 99 })).toBeNull();
  });
  it("多版面、区域与块来自真实几何，不修改文档", () => {
    const doc = withBoard([text("\n  \n 第一段内容\n第二段")]);
    doc.boards.push(createBoardShape({ x: 600, y: -100 }, id));
    const before = structuredClone(doc);
    const summary = summarizeCanvas(doc)!;
    expect(doc).toEqual(before);
    expect(summary).toMatchObject({ pages: 2, blocks: 3, excerpt: "第一段内容" });
    expect(summary.shapes.filter((s) => s.kind === "board")).toHaveLength(2);
    expect(summary.shapes.some((s) => s.kind === "region")).toBe(true);
    expect(summary.shapes.some((s) => s.kind === "text")).toBe(true);
    for (const shape of summary.shapes) {
      expect(shape.x).toBeGreaterThanOrEqual(0);
      expect(shape.y).toBeGreaterThanOrEqual(0);
      expect(shape.x + shape.width).toBeLessThanOrEqual(1.0001);
      expect(shape.y + shape.height).toBeLessThanOrEqual(1.0001);
    }
  });
  it("只有自由文本/图片时仍有图形和摘要，图片不泄露 URL", () => {
    const doc = emptyDoc();
    doc.freeItems = [
      { id: id(), x: -500, y: -100, width: 320, zIndex: 0, block: { id: id(), type: "text", role: "body", text: "自由灵感" } },
      { id: id(), x: 0, y: 0, width: 320, zIndex: 1, block: { id: id(), type: "image", fit: "contain", asset: { url: "https://example.com/private.png", naturalWidth: 800, naturalHeight: 400 } } },
    ];
    const summary = summarizeCanvas(doc)!;
    expect(summary).toMatchObject({ pages: 0, blocks: 2, excerpt: "自由灵感" });
    expect(summary.shapes.map((s) => s.kind)).toEqual(["text", "image"]);
    expect(JSON.stringify(summary)).not.toContain("private.png");
  });
  it("只有图片的版面有图片占位但无虚构摘要", () => {
    const summary = summarizeCanvas(withBoard([{ id: id(), type: "image", fit: "cover", asset: { url: "mock-image:sample", naturalWidth: 600, naturalHeight: 400 } }]))!;
    expect(summary.excerpt).toBe("");
    expect(summary.blocks).toBe(1);
    expect(summary.shapes.some((s) => s.kind === "image")).toBe(true);
  });
  it("超过预算时最多 40 个图形，计数仍完整；excerpt 不拆 Unicode 字符", () => {
    const doc = emptyDoc();
    doc.boards = Array.from({ length: 25 }, (_, index) => {
      const board = createBoardShape({ x: index * 700, y: 0 }, id);
      board.regions[0].sections[0].columns[0].blocks = [text("🌱".repeat(100))];
      return board;
    });
    const summary = summarizeCanvas(doc)!;
    expect(summary.pages).toBe(25);
    expect(summary.blocks).toBe(50);
    expect(summary.shapes).toHaveLength(40);
    expect(summary.shapes.filter((s) => s.kind === "board")).toHaveLength(25);
    expect(summary.excerpt).toBe("🌱".repeat(80));
  });
  it("v1 读取兼容且 DTO 仅含 metadata + summary", () => {
    const content = { schemaVersion: 1, boards: [], freeItems: [] };
    const dto = canvasListDto({ id: "id", title: "test", created_at: "a", updated_at: "b", content });
    expect(Object.keys(dto).sort()).toEqual(["created_at", "id", "summary", "title", "updated_at"]);
    expect(dto.summary?.pages).toBe(0);
  });
});
