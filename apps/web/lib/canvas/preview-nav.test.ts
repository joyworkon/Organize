import { describe, expect, it } from "vitest";
import { createBoardSkeleton } from "./commands";
import { CANVAS_SCHEMA_VERSION, emptyDoc, type CanvasDoc } from "./model";
import { previewPageStep, resolvePreviewBoardId, stepPreviewBoardId } from "./preview-nav";
import type { Scene } from "./layout";

/** 两页紧邻的文档（页宽 640）：第一页 0..640，第二页 700..1340，各带一个标题模块。 */
function twoBoardDoc(): { doc: CanvasDoc; scene: Scene } {
  let id = 0;
  const gen = () => `pn-${++id}`;
  const step1 = createBoardSkeleton(emptyDoc(), { at: { x: 0, y: 0 }, variant: "blank" }, gen);
  const step2 = createBoardSkeleton(step1.doc, { at: { x: 700, y: 0 }, variant: "blank" }, gen);
  const doc = step2.doc;
  const scene: Scene = {
    boards: doc.boards.map((b, i) => ({
      boardId: b.id,
      x: i === 0 ? 0 : 700,
      y: 0,
      width: b.width,
      height: 800,
      regions: [],
    })),
    freeItems: [],
  };
  return { doc, scene };
}

function firstBlockId(doc: CanvasDoc, boardIndex: number): string {
  return doc.boards[boardIndex].regions[0].sections[0].columns[0].blocks[0].id;
}

describe("resolvePreviewBoardId（进入预览落页）", () => {
  it("无页面返回 null，空选区/失效选区回落第一页", () => {
    const empty: CanvasDoc = { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] };
    expect(resolvePreviewBoardId(empty, { boards: [], freeItems: [] }, null)).toBeNull();
    expect(resolvePreviewBoardId(empty, { boards: [], freeItems: [] }, { kind: "board", boardId: "x" })).toBeNull();

    const { doc, scene } = twoBoardDoc();
    expect(resolvePreviewBoardId(doc, scene, null)).toBe(doc.boards[0].id);
    expect(resolvePreviewBoardId(doc, scene, { kind: "board", boardId: "gone" })).toBe(doc.boards[0].id);
    expect(resolvePreviewBoardId(doc, scene, { kind: "block", blockId: "gone" })).toBe(doc.boards[0].id);
  });

  it("页面/区块选区直接归属所在页", () => {
    const { doc, scene } = twoBoardDoc();
    expect(resolvePreviewBoardId(doc, scene, { kind: "board", boardId: doc.boards[1].id })).toBe(doc.boards[1].id);
    const regionId = doc.boards[1].regions[0].id;
    expect(resolvePreviewBoardId(doc, scene, { kind: "region", boardId: doc.boards[1].id, regionId })).toBe(doc.boards[1].id);
    expect(resolvePreviewBoardId(doc, scene, { kind: "block", blockId: firstBlockId(doc, 1) })).toBe(doc.boards[1].id);
    expect(resolvePreviewBoardId(doc, scene, { kind: "blocks", blockIds: [firstBlockId(doc, 0)] })).toBe(doc.boards[0].id);
  });

  it("自由元素按重叠面积最大，其次中心最近归属页面", () => {
    const { doc, scene } = twoBoardDoc();
    scene.freeItems = [
      { itemId: "overlap-both", x: 560, y: 0, width: 240, height: 300, zIndex: 1 }, // 跨接两页：第一页 80×300，第二页 100×300
      { itemId: "near-first", x: -300, y: 500, width: 100, height: 60, zIndex: 1 }, // 无重叠，离第一页更近
      { itemId: "overlap-first", x: -50, y: 100, width: 120, height: 100, zIndex: 1 }, // 只与第一页重叠
    ];
    expect(resolvePreviewBoardId(doc, scene, { kind: "free", itemId: "overlap-both" })).toBe(doc.boards[1].id);
    expect(resolvePreviewBoardId(doc, scene, { kind: "free", itemId: "near-first" })).toBe(doc.boards[0].id);
    expect(resolvePreviewBoardId(doc, scene, { kind: "free", itemId: "overlap-first" })).toBe(doc.boards[0].id);
    // 多选按页面聚合重叠面积：第一页 7000+24000 大于第二页 30000，归第一页
    expect(resolvePreviewBoardId(doc, scene, { kind: "frees", itemIds: ["overlap-first", "overlap-both"] })).toBe(doc.boards[0].id);
    // 选中的自由元素不在场景（已删除）：回落第一页
    expect(resolvePreviewBoardId(doc, scene, { kind: "free", itemId: "missing" })).toBe(doc.boards[0].id);
  });

  it("连接线按两端自由元素几何归属页面", () => {
    const { doc, scene } = twoBoardDoc();
    scene.freeItems = [
      { itemId: "a", x: 800, y: 0, width: 100, height: 100, zIndex: 1 },
      { itemId: "b", x: 100, y: 0, width: 100, height: 100, zIndex: 1 },
    ];
    doc.connectors = [{ id: "edge", from: "a", to: "b", arrow: "none", line: "solid", color: "", label: "" }];
    // 两端各重叠一页且面积相同：取第一页（遍历顺序中并列最大保持先出现者）
    expect(resolvePreviewBoardId(doc, scene, { kind: "connector", connectorId: "edge" })).toBe(doc.boards[0].id);
    expect(resolvePreviewBoardId(doc, scene, { kind: "connector", connectorId: "gone" })).toBe(doc.boards[0].id);
  });
});

describe("stepPreviewBoardId（翻页循环）", () => {
  it("正反向循环，末尾↔首页互切", () => {
    const { doc } = twoBoardDoc();
    expect(stepPreviewBoardId(doc, doc.boards[0].id, 1)).toBe(doc.boards[1].id);
    expect(stepPreviewBoardId(doc, doc.boards[1].id, 1)).toBe(doc.boards[0].id);
    expect(stepPreviewBoardId(doc, doc.boards[0].id, -1)).toBe(doc.boards[1].id);
    expect(stepPreviewBoardId(doc, doc.boards[1].id, -1)).toBe(doc.boards[0].id);
  });

  it("单页自返，无页返回 null，失效 current 按方向取端点页", () => {
    const { doc } = twoBoardDoc();
    const single: CanvasDoc = { ...doc, boards: [doc.boards[0]] };
    expect(stepPreviewBoardId(single, doc.boards[0].id, 1)).toBe(doc.boards[0].id);
    expect(stepPreviewBoardId(single, doc.boards[0].id, -1)).toBe(doc.boards[0].id);
    expect(stepPreviewBoardId(single, null, 1)).toBe(doc.boards[0].id);
    const empty: CanvasDoc = { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] };
    expect(stepPreviewBoardId(empty, null, 1)).toBeNull();
    expect(stepPreviewBoardId(doc, null, 1)).toBe(doc.boards[0].id);
    expect(stepPreviewBoardId(doc, null, -1)).toBe(doc.boards[1].id);
    expect(stepPreviewBoardId(doc, "gone", -1)).toBe(doc.boards[1].id);
  });
});

describe("previewPageStep（翻页按键）", () => {
  it("→ / PageDown / Space 下一页，← / PageUp / Shift+Space 上一页", () => {
    expect(previewPageStep({ key: "ArrowRight", code: "ArrowRight", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(1);
    expect(previewPageStep({ key: "PageDown", code: "PageDown", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(1);
    expect(previewPageStep({ key: " ", code: "Space", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(1);
    expect(previewPageStep({ key: "ArrowLeft", code: "ArrowLeft", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(-1);
    expect(previewPageStep({ key: "PageUp", code: "PageUp", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(-1);
    expect(previewPageStep({ key: " ", code: "Space", metaKey: false, ctrlKey: false, altKey: false, shiftKey: true })).toBe(-1);
  });

  it("修饰键组合与非翻页键不触发", () => {
    expect(previewPageStep({ key: "ArrowRight", code: "ArrowRight", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(0);
    expect(previewPageStep({ key: " ", code: "Space", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false })).toBe(0);
    expect(previewPageStep({ key: "ArrowLeft", code: "ArrowLeft", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false })).toBe(0);
    expect(previewPageStep({ key: "Enter", code: "Enter", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(0);
  });
});
