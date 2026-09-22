import { describe, expect, it } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  emptyDoc,
  createRegion,
  createSection,
  createColumn,
  createTextBlock,
  type CanvasDoc,
} from "./model";
import { createBoard } from "./commands";
import { describeInsertTarget, resolveInsertTarget, type LastActiveTarget } from "./insert-target";

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

/** 双区块页面：region-A（一行两列两块）+ region-B（一行一列一块）。 */
function docWithTwoRegions(): {
  doc: CanvasDoc;
  boardId: string;
  regionAId: string;
  regionBId: string;
  sectionAId: string;
  columnA1Id: string;
  columnA2Id: string;
  blockA1Id: string;
  blockA2Id: string;
  blockB1Id: string;
} {
  const ids = counterIds();
  const doc = emptyDoc();
  const board = createBoard(doc, { x: 0, y: 0 }, ids).doc.boards[0];
  const blockA1 = createTextBlock("body", "A1", ids);
  const blockA2 = createTextBlock("body", "A2", ids);
  const regionA = createRegion(
    [
      createSection(
        [
          createColumn([blockA1], ids),
          createColumn([blockA2], ids),
        ],
        ids,
      ),
    ],
    ids,
    "头部",
  );
  const blockB1 = createTextBlock("body", "B1", ids);
  const regionB = createRegion([createSection([createColumn([blockB1], ids)], ids)], ids, "中部");
  board.regions = [regionA, regionB];
  return {
    doc: { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [board], freeItems: [] },
    boardId: board.id,
    regionAId: regionA.id,
    regionBId: regionB.id,
    sectionAId: regionA.sections[0].id,
    columnA1Id: regionA.sections[0].columns[0].id,
    columnA2Id: regionA.sections[0].columns[1].id,
    blockA1Id: blockA1.id,
    blockA2Id: blockA2.id,
    blockB1Id: blockB1.id,
  };
}

describe("resolveInsertTarget 规则优先级（B2）", () => {
  it("规则1：explicit 携带位置 → 插入该位置（块锚点）", () => {
    const fx = docWithTwoRegions();
    const target = resolveInsertTarget(
      fx.doc,
      null,
      {
        kind: "column",
        boardId: fx.boardId,
        regionId: fx.regionAId,
        sectionId: fx.sectionAId,
        columnId: fx.columnA1Id,
        afterBlockId: fx.blockA1Id,
      },
      null,
    );
    expect(target).toEqual({
      kind: "column",
      boardId: fx.boardId,
      regionId: fx.regionAId,
      sectionId: fx.sectionAId,
      columnId: fx.columnA1Id,
      afterBlockId: fx.blockA1Id,
    });
  });

  it("规则1：explicit 区块末尾（区块间＋）", () => {
    const fx = docWithTwoRegions();
    const target = resolveInsertTarget(
      fx.doc,
      { kind: "block", blockId: fx.blockB1Id }, // 即使选中了块，explicit 优先
      { kind: "region-end", boardId: fx.boardId, regionId: fx.regionAId },
      null,
    );
    expect(target).toEqual({ kind: "region-end", boardId: fx.boardId, regionId: fx.regionAId });
  });

  it("规则1：explicit 锚点已删除 → 降级走后续规则", () => {
    const fx = docWithTwoRegions();
    const target = resolveInsertTarget(
      fx.doc,
      { kind: "block", blockId: fx.blockA2Id },
      {
        kind: "column",
        boardId: fx.boardId,
        regionId: fx.regionAId,
        sectionId: fx.sectionAId,
        columnId: fx.columnA1Id,
        afterBlockId: "ghost-block",
      },
      null,
    );
    // 块锚点不存在 → 规则 2：选中块所在列其后
    expect(target).toEqual({
      kind: "column",
      boardId: fx.boardId,
      regionId: fx.regionAId,
      sectionId: fx.sectionAId,
      columnId: fx.columnA2Id,
      afterBlockId: fx.blockA2Id,
    });
  });

  it("规则2：选中内容块 → 同列该块之后", () => {
    const fx = docWithTwoRegions();
    const target = resolveInsertTarget(fx.doc, { kind: "block", blockId: fx.blockA1Id }, null, null);
    expect(target).toEqual({
      kind: "column",
      boardId: fx.boardId,
      regionId: fx.regionAId,
      sectionId: fx.sectionAId,
      columnId: fx.columnA1Id,
      afterBlockId: fx.blockA1Id,
    });
  });

  it("规则2：选中块已删除 → 降级规则6 lastActive", () => {
    const fx = docWithTwoRegions();
    const lastActive: LastActiveTarget = { boardId: fx.boardId, regionId: fx.regionBId };
    const target = resolveInsertTarget(fx.doc, { kind: "block", blockId: "ghost" }, null, lastActive);
    expect(target).toEqual({ kind: "region-end", boardId: fx.boardId, regionId: fx.regionBId });
  });

  it("规则4：选中区块 → 该区块末尾追加一行", () => {
    const fx = docWithTwoRegions();
    const target = resolveInsertTarget(
      fx.doc,
      { kind: "region", boardId: fx.boardId, regionId: fx.regionAId },
      null,
      null,
    );
    expect(target).toEqual({ kind: "region-end", boardId: fx.boardId, regionId: fx.regionAId });
  });

  it("规则5：选中页面 → 最后一个区块", () => {
    const fx = docWithTwoRegions();
    const target = resolveInsertTarget(fx.doc, { kind: "board", boardId: fx.boardId }, null, null);
    expect(target).toEqual({ kind: "region-end", boardId: fx.boardId, regionId: fx.regionBId });
  });

  it("规则6：无选中 → lastActiveTarget 页面+区块", () => {
    const fx = docWithTwoRegions();
    const lastActive: LastActiveTarget = { boardId: fx.boardId, regionId: fx.regionAId };
    const target = resolveInsertTarget(fx.doc, null, null, lastActive);
    expect(target).toEqual({ kind: "region-end", boardId: fx.boardId, regionId: fx.regionAId });
  });

  it("规则6：选中自由容器 → 也走 lastActive（不默认创建自由内容）", () => {
    const fx = docWithTwoRegions();
    const docWithFree: CanvasDoc = {
      ...fx.doc,
      freeItems: [
        {
          id: "f1",
          x: 0,
          y: 0,
          width: 200,
          zIndex: 1,
          block: createTextBlock("body", "自由", counterIds()),
        },
      ],
    };
    const lastActive: LastActiveTarget = { boardId: fx.boardId, regionId: fx.regionBId };
    const target = resolveInsertTarget(docWithFree, { kind: "free", itemId: "f1" }, null, lastActive);
    expect(target).toEqual({ kind: "region-end", boardId: fx.boardId, regionId: fx.regionBId });
  });

  it("规则6→退化：lastActive 失效但文档有页面 → 最后一个页面的最后区块", () => {
    const fx = docWithTwoRegions();
    const stale: LastActiveTarget = { boardId: fx.boardId, regionId: "ghost-region" };
    const target = resolveInsertTarget(fx.doc, null, null, stale);
    expect(target).toEqual({ kind: "region-end", boardId: fx.boardId, regionId: fx.regionBId });
  });

  it("规则7：完全空白（无 board）→ create:page", () => {
    const target = resolveInsertTarget(emptyDoc(), null, null, null);
    expect(target).toEqual({ create: "page" });
  });

  it("规则7：lastActive 指向空文档 → create:page", () => {
    const stale: LastActiveTarget = { boardId: "b", regionId: "r" };
    expect(resolveInsertTarget(emptyDoc(), null, null, stale)).toEqual({ create: "page" });
  });
});

describe("describeInsertTarget 目标提示", () => {
  it("空白 → 添加到：新页面", () => {
    expect(describeInsertTarget(emptyDoc(), { create: "page" })).toBe("添加到：新页面");
  });

  it("区块目标 → 区块名", () => {
    const fx = docWithTwoRegions();
    expect(
      describeInsertTarget(fx.doc, { kind: "region-end", boardId: fx.boardId, regionId: fx.regionAId }),
    ).toBe("添加到：头部");
  });
});
