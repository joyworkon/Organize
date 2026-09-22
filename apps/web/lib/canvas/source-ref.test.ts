// 阶段 E：sourceRef 收集与校验（lib/canvas/source-ref.ts）
import { describe, expect, it } from "vitest";
import {
  createMaterialCardBlock,
  createTextBlock,
  createImageBlock,
  emptyDoc,
  createBoardShape,
  CANVAS_SCHEMA_VERSION,
  type CanvasBlock,
  type CanvasDoc,
  type CanvasSourceRef,
} from "./model";
import {
  blockSourceRef,
  collectSourceRefs,
  sourceRefKey,
  validateSourceRefField,
} from "./source-ref";

const ref = (over: Partial<CanvasSourceRef> = {}): CanvasSourceRef => ({
  kind: "reading",
  id: "item-1",
  title: "标题",
  ...over,
});

function docWithBlocks(rows: CanvasBlock[][]): CanvasDoc {
  const board = createBoardShape({ x: 0, y: 0 }, () => "id");
  board.regions[0].sections = rows.map((blocks, i) => ({
    id: `s${i + 1}`,
    widthMode: "equal" as const,
    columnWeights: [1],
    columns: [{ id: `c${i + 1}`, blocks }],
  }));
  return { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [board], freeItems: [] };
}

describe("source-ref", () => {
  it("sourceRefKey：kind:id 组合键", () => {
    expect(sourceRefKey("reading", "a")).toBe("reading:a");
    expect(sourceRefKey("memo", "b")).toBe("memo:b");
  });

  it("blockSourceRef：materialCard 必有；text/image 可有；其余无", () => {
    const card = createMaterialCardBlock({ title: "t", text: "x", sourceRef: ref() }, () => "m1");
    expect(blockSourceRef(card)).toEqual(ref());
    const text = { ...createTextBlock("body", "hi"), sourceRef: ref({ kind: "memo" }) };
    expect(blockSourceRef(text)?.kind).toBe("memo");
    const image = { ...createImageBlock(null), sourceRef: ref() };
    expect(blockSourceRef(image)?.id).toBe("item-1");
    expect(blockSourceRef(createTextBlock("body"))).toBeUndefined();
  });

  it("collectSourceRefs：跨行收集并按 kind+id 去重（稳定顺序）", () => {
    const a = createMaterialCardBlock({ title: "A", text: "", sourceRef: ref({ id: "a" }) }, () => "b1");
    const b = { ...createTextBlock("body", "摘录"), sourceRef: ref({ id: "a", kind: "memo" }) };
    const c = { ...createTextBlock("body", "同上"), sourceRef: ref({ id: "a" }) }; // 与 a 重复
    const d = { ...createImageBlock(null), sourceRef: ref({ id: "d" }) };
    const doc = docWithBlocks([[a, b], [c, d]]);
    const refs = collectSourceRefs(doc);
    expect(refs.map((r) => `${r.kind}:${r.id}`)).toEqual(["reading:a", "memo:a", "reading:d"]);
  });

  it("collectSourceRefs：空文档无引用", () => {
    expect(collectSourceRefs(emptyDoc())).toEqual([]);
  });

  it("validateSourceRefField：合法引用通过", () => {
    const errors: string[] = [];
    expect(validateSourceRefField(ref({ excerpt: "摘", url: "https://x", updatedAt: "2026-09-22T00:00:00Z" }), errors, "b")).toBe(true);
    expect(errors).toEqual([]);
  });

  it("validateSourceRefField：缺 id / 非法 kind / 超长 title 都报错", () => {
    const errors: string[] = [];
    validateSourceRefField({ kind: "note", id: "", title: "x".repeat(201) }, errors, "b");
    expect(errors.some((e) => e.includes("kind"))).toBe(true);
    expect(errors.some((e) => e.includes("id"))).toBe(true);
    expect(errors.some((e) => e.includes("title"))).toBe(true);
  });

  it("validateSourceRefField：非对象直接报错", () => {
    const errors: string[] = [];
    expect(validateSourceRefField("nope", errors, "b")).toBe(false);
    expect(errors).toHaveLength(1);
  });
});
