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
    b.regions[0].sections[1].columns[0].blocks[0].id = b.regions[0].sections[0].columns[0].blocks[0].id;
    const res = validateCanvasContent(doc);
    expect(res.errors.some((e) => e.includes("重复 ID"))).toBe(true);
  });

  it("非法坐标/宽度/权重拒绝", () => {
    const doc = validDoc();
    doc.boards[0].x = Number.NaN;
    expect(validateCanvasContent(doc).errors.length).toBeGreaterThan(0);
    const doc2 = validDoc();
    doc2.boards[0].regions[0].sections[1].columnWeights = [0];
    expect(validateCanvasContent(doc2).errors.some((e) => e.includes("columnWeights"))).toBe(true);
    const doc3 = validDoc();
    doc3.boards[0].width = 99999;
    expect(validateCanvasContent(doc3).errors.some((e) => e.includes("width"))).toBe(true);
  });

  it("未知块类型：保留原数据并报告 unknownBlockIds（防不兼容保存）", () => {
    const doc = validDoc() as unknown as Record<string, unknown>;
    const board = (doc.boards as Array<Record<string, unknown>>)[0];
    const section = ((board.regions as Array<Record<string, unknown>>)[0].sections as Array<Record<string, unknown>>)[1];
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
    const blocks = ((res.doc!.boards[0].regions[0].sections[1].columns[0]) as { blocks: unknown[] }).blocks;
    expect(blocks).toHaveLength(2);
  });

  it("blob:/data: 图片地址拒绝；/storage/ 与 https 允许；mock 地址仅在 mock 模式允许", () => {
    const mk = (url: string) => {
      const doc = validDoc();
      const b = doc.boards[0].regions[0].sections[1].columns[0].blocks[0] = {
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
    (doc.boards[0].regions[0].sections[1].columns[0].blocks[0] as { text: string }).text = "a".repeat(
      CANVAS_LIMITS.maxTextLength + 1,
    );
    expect(validateCanvasContent(doc).errors.some((e) => e.includes("text"))).toBe(true);
  });

  it("图片容器比例 ratio：合法值放行，非法值拒绝（A5）", () => {
    const mk = (ratio: unknown) => {
      const doc = validDoc();
      doc.boards[0].regions[0].sections[1].columns[0].blocks[0] = {
        id: "img1",
        type: "image",
        asset: { url: "https://example.com/a.png", naturalWidth: 100, naturalHeight: 50 },
        fit: "contain",
        ratio,
      } as never;
      return doc;
    };
    for (const ratio of ["auto", "1:1", "4:3", "16:9", undefined, null]) {
      expect(validateCanvasContent(mk(ratio)).ok).toBe(true);
    }
    const bad = validateCanvasContent(mk("2:1"));
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.includes("ratio"))).toBe(true);
  });
});

describe("schemaVersion 2 规则（B1）", () => {
  it("v1 输入：先迁移再校验，返回的 doc 恒为 v2（服务端/保存写 v2 的前提）", () => {
    const v1 = {
      schemaVersion: 1,
      boards: [
        {
          id: "b1",
          x: 0,
          y: 0,
          width: 640,
          padding: 24,
          gap: 16,
          sections: [
            {
              id: "s1",
              widthMode: "equal",
              columnWeights: [1],
              columns: [
                { id: "c1", blocks: [{ id: "k1", type: "text", text: "旧数据", role: "title" }] },
              ],
            },
          ],
        },
      ],
      freeItems: [],
    };
    const res = validateCanvasContent(v1);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.doc!.schemaVersion).toBe(2);
    expect(res.doc!.boards[0].regions[0].sections[0].columns[0].blocks[0]).toMatchObject({
      type: "text",
      text: "旧数据",
    });
  });

  it("region 数量超限（每版面 20）拒绝", () => {
    const doc = validDoc();
    const board = doc.boards[0];
    const base = board.regions[0];
    for (let i = 0; i < 20; i += 1) {
      board.regions.push(structuredClone({ ...base, id: `r-${i}` }));
    }
    const res = validateCanvasContent(doc);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("regions"))).toBe(true);
  });

  it("region name 缺失/超长拒绝；style 非法字段拒绝", () => {
    const doc = validDoc();
    (doc.boards[0].regions[0] as unknown as Record<string, unknown>).name = "";
    expect(validateCanvasContent(doc).errors.some((e) => e.includes(".name"))).toBe(true);

    const doc2 = validDoc();
    doc2.boards[0].regions[0].name = "x".repeat(101);
    expect(validateCanvasContent(doc2).errors.some((e) => e.includes(".name"))).toBe(true);

    const doc3 = validDoc();
    doc3.boards[0].regions[0].style = { padding: -1 };
    expect(validateCanvasContent(doc3).errors.some((e) => e.includes("style.padding"))).toBe(true);

    const doc4 = validDoc();
    doc4.boards[0].regions[0].style = { rowGap: 999 };
    expect(validateCanvasContent(doc4).errors.some((e) => e.includes("style.rowGap"))).toBe(true);

    const doc5 = validDoc();
    doc5.boards[0].regions[0].style = { border: "yes" as never };
    expect(validateCanvasContent(doc5).errors.some((e) => e.includes("style.border"))).toBe(true);
  });

  it("region style 合法值放行（padding/rowGap/border/background）", () => {
    const doc = validDoc();
    doc.boards[0].regions[0].style = { padding: 24, rowGap: 12, border: true, background: "gray" };
    expect(validateCanvasContent(doc).ok).toBe(true);
  });

  it("未知更高 schemaVersion 仍拒绝（保留语义由 ensure 直返）", () => {
    const doc = { ...validDoc(), schemaVersion: 3 } as unknown as Record<string, unknown>;
    const res = validateCanvasContent(doc);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });
});

describe("B2 新块类型校验", () => {
  it("list 角色文本块合法", () => {
    const doc = validDoc();
    const column = doc.boards[0].regions[0].sections[0].columns[0];
    column.blocks.push({ id: "l1", type: "text", text: "甲\n乙", role: "list" });
    const res = validateCanvasContent(doc);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("divider 块合法（style.align 校验走通用 style 规则）", () => {
    const doc = validDoc();
    const column = doc.boards[0].regions[0].sections[0].columns[0];
    column.blocks.push({ id: "d1", type: "divider" });
    column.blocks.push({ id: "d2", type: "divider", style: { align: "center" } });
    expect(validateCanvasContent(doc).ok).toBe(true);

    const bad = validDoc();
    bad.boards[0].regions[0].sections[0].columns[0].blocks.push({
      id: "d3",
      type: "divider",
      style: { align: "diagonal" },
    } as never);
    expect(validateCanvasContent(bad).errors.some((e) => e.includes("style.align"))).toBe(true);
  });

  it("button 块：合法 http(s) 通过；javascript: 等非法协议拒绝", () => {
    const doc = validDoc();
    const column = doc.boards[0].regions[0].sections[0].columns[0];
    column.blocks.push({
      id: "b1",
      type: "button",
      label: "了解更多",
      href: "https://example.com",
      align: "center",
      variant: "secondary",
    });
    column.blocks.push({ id: "b2", type: "button", label: "未设置", href: "", align: "left", variant: "primary" });
    expect(validateCanvasContent(doc).ok).toBe(true);

    const bad = validDoc();
    bad.boards[0].regions[0].sections[0].columns[0].blocks.push({
      id: "b3",
      type: "button",
      label: "x",
      href: "javascript:alert(1)",
      align: "left",
      variant: "primary",
    });
    const res = validateCanvasContent(bad);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes(".href") && e.includes("http"))).toBe(true);
  });

  it("button 块：variant/label 非法拒绝", () => {
    const bad = validDoc();
    bad.boards[0].regions[0].sections[0].columns[0].blocks.push({
      id: "b4",
      type: "button",
      label: "x",
      href: "",
      align: "left",
      variant: "ghost",
    } as never);
    expect(validateCanvasContent(bad).errors.some((e) => e.includes(".variant"))).toBe(true);
  });

  it("未知块类型保留语义不变：保留数据 + 报 unknownBlockIds + 禁止保存", () => {
    const doc = validDoc();
    doc.boards[0].regions[0].sections[0].columns[0].blocks.push({
      id: "future-1",
      type: "database",
    } as never);
    const res = validateCanvasContent(doc);
    expect(res.unknownBlockIds).toEqual(["future-1"]);
    expect(res.doc?.boards[0].regions[0].sections[0].columns[0].blocks.some((b) => b.id === "future-1")).toBe(true);
    expect(isDocSavable(res)).toBe(false);
  });

  it("image.alt 合法/非法", () => {
    const doc = validDoc();
    const column = doc.boards[0].regions[0].sections[0].columns[0];
    column.blocks.push({ id: "i1", type: "image", asset: null, fit: "contain", alt: "示意图" });
    expect(validateCanvasContent(doc).ok).toBe(true);

    const bad = validDoc();
    bad.boards[0].regions[0].sections[0].columns[0].blocks.push({
      id: "i2",
      type: "image",
      asset: null,
      fit: "contain",
      alt: 42,
    } as never);
    expect(validateCanvasContent(bad).errors.some((e) => e.includes(".alt"))).toBe(true);
  });

  it("section.gap / verticalAlign 合法与非法", () => {
    const doc = validDoc();
    doc.boards[0].regions[0].sections[0].gap = 24;
    doc.boards[0].regions[0].sections[0].verticalAlign = "middle";
    expect(validateCanvasContent(doc).ok).toBe(true);

    const bad = validDoc();
    bad.boards[0].regions[0].sections[0].gap = 999;
    expect(validateCanvasContent(bad).errors.some((e) => e.includes(".gap"))).toBe(true);

    const bad2 = validDoc();
    bad2.boards[0].regions[0].sections[0].verticalAlign = "diagonal" as never;
    expect(validateCanvasContent(bad2).errors.some((e) => e.includes(".verticalAlign"))).toBe(true);
  });
});
