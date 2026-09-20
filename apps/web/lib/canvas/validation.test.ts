import { describe, expect, it } from "vitest";
import { createBoard } from "./commands";
import { emptyDoc } from "./model";
import { CANVAS_LIMITS, isDocSavable, validateCanvasContent } from "./validation";

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function validDoc() {
  return createBoard(emptyDoc(), { x: 0, y: 0 }, counterIds()).doc;
}

describe("validateCanvasContent", () => {
  it("合法文档通过", () => {
    const res = validateCanvasContent(validDoc());
    expect(res.errors).toEqual([]);
    expect(res.unknownBlockIds).toEqual([]);
    expect(res.ok).toBe(true);
    expect(isDocSavable(res)).toBe(true);
  });

  it("schemaVersion 不符直接拒绝", () => {
    const doc = { ...validDoc(), schemaVersion: 99 };
    expect(validateCanvasContent(doc).ok).toBe(false);
    expect(validateCanvasContent(null).ok).toBe(false);
    expect(validateCanvasContent("x").ok).toBe(false);
  });

  it("重复 ID 报错", () => {
    const doc = validDoc();
    const b = doc.boards[0];
    b.sections[1].columns[0].blocks[0].id = b.sections[0].columns[0].blocks[0].id;
    const res = validateCanvasContent(doc);
    expect(res.errors.some((e) => e.includes("重复 ID"))).toBe(true);
  });

  it("非法坐标/宽度/权重拒绝", () => {
    const doc = validDoc();
    doc.boards[0].x = Number.NaN;
    expect(validateCanvasContent(doc).errors.length).toBeGreaterThan(0);
    const doc2 = validDoc();
    doc2.boards[0].sections[1].columnWeights = [0];
    expect(validateCanvasContent(doc2).errors.some((e) => e.includes("columnWeights"))).toBe(true);
    const doc3 = validDoc();
    doc3.boards[0].width = 99999;
    expect(validateCanvasContent(doc3).errors.some((e) => e.includes("width"))).toBe(true);
  });

  it("未知块类型：保留原数据并报告 unknownBlockIds（防不兼容保存）", () => {
    const doc = validDoc() as unknown as Record<string, unknown>;
    const board = (doc.boards as Array<Record<string, unknown>>)[0];
    const section = (board.sections as Array<Record<string, unknown>>)[1];
    const column = (section.columns as Array<Record<string, unknown>>)[0];
    (column.blocks as Array<Record<string, unknown>>).push({
      id: "future-block",
      type: "video",
      src: "https://example.com/v.mp4",
    });
    const res = validateCanvasContent(doc);
    expect(res.unknownBlockIds).toEqual(["future-block"]);
    expect(res.ok).toBe(false);
    expect(isDocSavable(res)).toBe(false);
    // 数据仍在 doc 中（不静默删除）
    const blocks = ((res.doc!.boards[0].sections[1].columns[0]) as { blocks: unknown[] }).blocks;
    expect(blocks).toHaveLength(2);
  });

  it("blob:/data: 图片地址拒绝；/storage/ 与 https 允许；mock 地址仅在 mock 模式允许", () => {
    const mk = (url: string) => {
      const doc = validDoc();
      const b = doc.boards[0].sections[1].columns[0].blocks[0] = {
        id: "img1",
        type: "image",
        asset: { url, naturalWidth: 10, naturalHeight: 10 },
        fit: "contain",
      };
      void b;
      return doc;
    };
    expect(validateCanvasContent(mk("blob:xyz")).ok).toBe(false);
    expect(validateCanvasContent(mk("data:image/png;base64,xx")).ok).toBe(false);
    expect(validateCanvasContent(mk("/storage/v1/object/public/images/a/b.png")).ok).toBe(true);
    expect(validateCanvasContent(mk("https://supabase.co/storage/v1/object/public/images/a.png")).ok).toBe(true);
    expect(validateCanvasContent(mk("mock-image:abc"), { allowMockImages: true }).ok).toBe(true);
    expect(validateCanvasContent(mk("mock-image:abc")).ok).toBe(false);
  });

  it("超长文本与节点上限", () => {
    const doc = validDoc();
    (doc.boards[0].sections[1].columns[0].blocks[0] as { text: string }).text = "a".repeat(
      CANVAS_LIMITS.maxTextLength + 1,
    );
    expect(validateCanvasContent(doc).errors.some((e) => e.includes("text"))).toBe(true);
  });
});
