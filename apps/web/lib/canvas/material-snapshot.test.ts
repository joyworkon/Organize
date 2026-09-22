// 阶段 E：资料快照命令（appendMaterialCardToRegion / updateMaterialCard /
// updateMaterialSnapshot / detachSourceRef）——快照语义与可撤销性
import { describe, expect, it } from "vitest";
import {
  appendMaterialCardToRegion,
  updateMaterialCard,
  updateMaterialSnapshot,
  detachSourceRef,
} from "./commands";
import {
  createBoardShape,
  createImageBlock,
  createMaterialCardBlock,
  createTextBlock,
  CANVAS_SCHEMA_VERSION,
  type CanvasDoc,
  type CanvasSourceRef,
} from "./model";
import { validateCanvasContent } from "./validation";

const ref = (over: Partial<CanvasSourceRef> = {}): CanvasSourceRef => ({
  kind: "reading",
  id: "item-1",
  title: "原标题",
  excerpt: "原摘要",
  ...over,
});

let seq = 0;
const ids = () => `id-${++seq}`;

function makeDoc(): CanvasDoc {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    boards: [createBoardShape({ x: 0, y: 0 }, ids)],
    freeItems: [],
  };
}

describe("资料快照命令（阶段 E）", () => {
  it("appendMaterialCardToRegion：指定区块追加为末尾新行；regionId 缺省新建区块", () => {
    const doc = makeDoc();
    const regionId = doc.boards[0].regions[0].id;
    const before = doc.boards[0].regions[0].sections.length;
    const r = appendMaterialCardToRegion(
      doc,
      { boardId: doc.boards[0].id, regionId, title: "T", text: "X", sourceRef: ref() },
      ids,
    );
    const region = r.doc.boards[0].regions[0];
    expect(region.sections).toHaveLength(before + 1);
    const block = region.sections[region.sections.length - 1].columns[0].blocks[0];
    expect(block.type).toBe("materialCard");
    if (block.type === "materialCard") {
      expect(block.title).toBe("T");
      expect(block.sourceRef.id).toBe("item-1");
    }
    // 原 doc 不被修改（命令纯函数）
    expect(doc.boards[0].regions[0].sections).toHaveLength(before);

    // 缺省 regionId → 追加新区块
    const r2 = appendMaterialCardToRegion(
      r.doc,
      { boardId: doc.boards[0].id, title: "T2", text: "", sourceRef: ref({ id: "i2" }) },
      ids,
    );
    expect(r2.doc.boards[0].regions).toHaveLength(2);
  });

  it("appendMaterialCardToRegion：校验通过（materialCard 白名单 + sourceRef）", () => {
    const doc = makeDoc();
    const r = appendMaterialCardToRegion(
      doc,
      {
        boardId: doc.boards[0].id,
        regionId: doc.boards[0].regions[0].id,
        title: "T",
        text: "X",
        sourceRef: ref(),
      },
      ids,
    );
    const v = validateCanvasContent(JSON.parse(JSON.stringify(r.doc)));
    expect(v.unknownBlockIds).toEqual([]);
    expect(v.errors.filter((e) => e.includes("materialCard"))).toEqual([]);
  });

  it("updateMaterialCard：编辑标题/摘录（快照副本，一次事务）", () => {
    const doc = makeDoc();
    const r = appendMaterialCardToRegion(
      doc,
      {
        boardId: doc.boards[0].id,
        regionId: doc.boards[0].regions[0].id,
        title: "T",
        text: "X",
        sourceRef: ref(),
      },
      ids,
    );
    const block = r.doc.boards[0].regions[0].sections.at(-1)!.columns[0].blocks[0];
    const r2 = updateMaterialCard(r.doc, { blockId: block.id, title: "改后", text: "改后正文" });
    const b2 = r2.doc.boards[0].regions[0].sections.at(-1)!.columns[0].blocks[0];
    expect(b2.type).toBe("materialCard");
    if (b2.type === "materialCard") {
      expect(b2.title).toBe("改后");
      expect(b2.text).toBe("改后正文");
    }
    // 原 doc 不变
    const b0 = r.doc.boards[0].regions[0].sections.at(-1)!.columns[0].blocks[0];
    expect(b0.type === "materialCard" && b0.title).toBe("T");
  });

  it("updateMaterialSnapshot：materialCard 重建快照并刷新 sourceRef", () => {
    const doc = makeDoc();
    const r = appendMaterialCardToRegion(
      doc,
      {
        boardId: doc.boards[0].id,
        regionId: doc.boards[0].regions[0].id,
        title: "旧",
        text: "旧文",
        sourceRef: ref(),
      },
      ids,
    );
    const block = r.doc.boards[0].regions[0].sections.at(-1)!.columns[0].blocks[0];
    const r2 = updateMaterialSnapshot(r.doc, {
      blockId: block.id,
      title: "新",
      text: "新文",
      sourceRef: ref({ title: "新", updatedAt: "2026-09-22T12:00:00Z" }),
    });
    const b2 = r2.doc.boards[0].regions[0].sections.at(-1)!.columns[0].blocks[0];
    expect(b2.type).toBe("materialCard");
    if (b2.type === "materialCard") {
      expect(b2.title).toBe("新");
      expect(b2.text).toBe("新文");
      expect(b2.sourceRef.updatedAt).toBe("2026-09-22T12:00:00Z");
    }
  });

  it("updateMaterialSnapshot：text 块替换摘录与来源", () => {
    const doc = makeDoc();
    const text = { ...createTextBlock("body", "旧摘录", ids), sourceRef: ref({ kind: "memo", id: "m1" }) };
    doc.boards[0].regions[0].sections[0].columns[0].blocks.push(text);
    const r = updateMaterialSnapshot(doc, {
      blockId: text.id,
      text: "新摘录",
      sourceRef: ref({ kind: "memo", id: "m1", title: "新" }),
    });
    const b = r.doc.boards[0].regions[0].sections[0].columns[0].blocks.at(-1)!;
    expect(b.type === "text" && b.text).toBe("新摘录");
    expect(b.type === "text" && b.sourceRef?.title).toBe("新");
  });

  it("updateMaterialSnapshot：image 块替换资产与来源（画布自有资产副本）", () => {
    const doc = makeDoc();
    const image = { ...createImageBlock(null, ids), sourceRef: ref() };
    doc.boards[0].regions[0].sections[0].columns[0].blocks.push(image);
    const asset = {
      url: "/storage/v1/object/public/images/x.png",
      naturalWidth: 100,
      naturalHeight: 50,
      uploadStatus: "saved" as const,
    };
    const r = updateMaterialSnapshot(doc, {
      blockId: image.id,
      asset,
      alt: "新图",
      sourceRef: ref({ id: "item-2" }),
    });
    const b = r.doc.boards[0].regions[0].sections[0].columns[0].blocks.at(-1)!;
    expect(b.type === "image" && b.asset?.url).toBe(asset.url);
    expect(b.type === "image" && b.sourceRef?.id).toBe("item-2");
  });

  it("detachSourceRef：text/image 移除引用保留内容；materialCard 为 no-op", () => {
    const doc = makeDoc();
    const text = { ...createTextBlock("body", "摘录", ids), sourceRef: ref() };
    doc.boards[0].regions[0].sections[0].columns[0].blocks.push(text);
    const r = detachSourceRef(doc, { blockId: text.id });
    const b = r.doc.boards[0].regions[0].sections[0].columns[0].blocks.at(-1)!;
    expect(b.type === "text" && b.text).toBe("摘录");
    expect(b.type === "text" && b.sourceRef).toBeUndefined();

    const card = createMaterialCardBlock({ title: "t", text: "", sourceRef: ref() }, ids);
    doc.boards[0].regions[0].sections[0].columns[0].blocks.push(card);
    const r2 = detachSourceRef(doc, { blockId: card.id });
    const b2 = r2.doc.boards[0].regions[0].sections[0].columns[0].blocks.at(-1)!;
    expect(b2.type === "materialCard").toBe(true); // 卡片来源不可移除
  });

  it("快照文档通过整体验证（含既有骨架块）", () => {
    const doc = makeDoc();
    const r = appendMaterialCardToRegion(
      doc,
      {
        boardId: doc.boards[0].id,
        regionId: doc.boards[0].regions[0].id,
        title: "T",
        text: "X",
        sourceRef: ref(),
      },
      ids,
    );
    const v = validateCanvasContent(r.doc, { allowMockImages: true });
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });
});
