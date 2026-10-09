import { describe, expect, it } from "vitest";
import { createBoardSkeleton, insertBlockBelow, insertColumn, insertRegionAfter, insertSectionAfter } from "./commands";
import { emptyDoc, findBlockLocation } from "./model";
import { computeScene } from "./layout";
import { computeInsertPreview, type CanvasInsertPreview } from "./insert-preview";

const measure = () => 24;

describe("插入预览与真实命令共用结构和布局", () => {
  for (const kind of ["column-left", "column-right", "block-below", "section-band", "region-band"] as const) {
    it(`${kind}：落点一致，原文档不变`, () => {
      let id = 0;
      const doc = createBoardSkeleton(emptyDoc(), { at: { x: 211, y: -37 }, variant: "blank" }, () => `source-${++id}`).doc;
      const board = doc.boards[0];
      board.regions[0].style = { padding: 16, rowGap: 32 };
      const region = board.regions[0];
      const section = region.sections[0];
      const column = section.columns[0];
      const action: CanvasInsertPreview = kind === "column-left" || kind === "column-right"
        ? { kind, sectionId: section.id, columnId: column.id }
        : kind === "block-below" ? { kind, blockId: column.blocks[0].id }
          : kind === "section-band" ? { kind, sectionId: section.id } : { kind, regionId: region.id };
      const before = JSON.stringify(doc);
      const preview = computeInsertPreview(board, action, measure)!;
      const result = kind === "column-left" || kind === "column-right"
        ? insertColumn(doc, { boardId: board.id, sectionId: section.id, columnId: column.id, side: kind === "column-left" ? "left" : "right" })
        : kind === "block-below" ? insertBlockBelow(doc, { blockId: column.blocks[0].id })
          : kind === "section-band" ? insertSectionAfter(doc, { boardId: board.id, sectionId: section.id })
            : insertRegionAfter(doc, { boardId: board.id, regionId: region.id });
      expect(result.focus?.kind).toBe("block");
      if (result.focus?.kind !== "block") return;
      const focus = result.focus;
      const location = findBlockLocation(result.doc, focus.blockId)!;
      const scene = computeScene(result.doc, measure).boards[0];
      const r = scene.regions.find((r) => r.regionId === location.region.id)!;
      const c = r.sections.find((s) => s.sectionId === location.section.id)!.columns.find((c) => c.columnId === location.column.id)!;
      const expected = kind === "region-band"
        ? { x: board.x + board.padding, y: r.y, width: board.width - board.padding * 2, height: r.height }
        : kind === "column-left" || kind === "column-right"
          ? { x: c.x, y: c.y, width: c.width, height: c.height }
          : c.blocks.find((b) => b.blockId === focus.blockId)!;
      expect(preview).toMatchObject({ x: expected.x, y: expected.y, width: expected.width, height: expected.height });
      expect(JSON.stringify(doc)).toBe(before);
    });
  }
});
