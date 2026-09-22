import { describe, expect, it } from "vitest";
import {
  BOARD_DEFAULT_WIDTH,
  BOARD_PADDING,
  createBoardShape,
  emptyDoc,
} from "./model";
import {
  applyCanvasTemplate,
  applyColumnDrag,
  applySmartWeights,
  attachFreeItemToRegion,
  createBoard,
  createBoardAutoPlace,
  createBoardSkeleton,
  createFreeImage,
  createFreeText,
  deleteBlock,
  deleteBoard,
  deleteFreeItem,
  deleteRegion,
  duplicateBlock,
  duplicateRegion,
  insertBlockAtTarget,
  insertBlockBelow,
  insertColumn,
  insertRegionAfter,
  insertSectionAfter,
  moveBlock,
  moveRegion,
  removeColumn,
  renameBoard,
  renameRegion,
  resizeBoard,
  setColumnWeights,
  setSectionWidthMode,
  setImageAsset,
  setImageFit,
  splitTextToSection,
  updateBlockStyle,
  updateBoardPadding,
  updateButtonBlock,
  updateFreeItem,
  updateFreeItemBlock,
  updateImageBlock,
  updateSectionLayout,
  updateTextBlock,
  updateTextRole,
} from "./commands";

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function docWithBoard() {
  const doc = emptyDoc();
  const res = createBoard(doc, { x: 0, y: 0 }, counterIds());
  return { doc: res.doc, board: res.doc.boards[0], focus: res.focus };
}

describe("createBoard", () => {
  it("双击建版面：出现在指定世界坐标，标题聚焦（A01 结构层）", () => {
    const doc = emptyDoc();
    const res = createBoard(doc, { x: 123, y: 456 }, counterIds());
    expect(res.doc.boards).toHaveLength(1);
    const b = res.doc.boards[0];
    expect(b.x).toBe(123);
    expect(b.y).toBe(456);
    expect(b.width).toBe(BOARD_DEFAULT_WIDTH);
    // 首块是标题，焦点在标题并进入编辑
    const first = b.regions[0].sections[0].columns[0].blocks[0];
    expect(first).toMatchObject({ type: "text", role: "title" });
    expect(res.focus).toMatchObject({ kind: "block", blockId: first.id, edit: true });
    // 原文档不被修改（纯函数）
    expect(doc.boards).toHaveLength(0);
  });
});

describe("insertSectionAfter（Enter / 添加通栏）", () => {
  it("标题分区 Enter：标题宽度不变，新正文分区在下方（A02）", () => {
    const { doc, board } = docWithBoard();
    const titleSection = board.regions[0].sections[0];
    const res = insertSectionAfter(
      doc,
      { boardId: board.id, sectionId: titleSection.id },
      counterIds(),
    );
    const b2 = res.doc.boards[0];
    expect(b2.regions[0].sections).toHaveLength(3);
    expect(b2.regions[0].sections[0].id).toBe(titleSection.id);
    expect(b2.regions[0].sections[0].columns).toHaveLength(1); // 标题仍通栏
    const newBlock = b2.regions[0].sections[1].columns[0].blocks[0];
    expect(newBlock).toMatchObject({ type: "text", role: "body" });
    expect(res.focus).toMatchObject({ blockId: newBlock.id });
  });

  it("多列分区中间 Enter：新通栏插在整个分区之后，后续分区顺延（A03）", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns.push({ id: "col-2", blocks: [{ id: "b2", type: "text", text: "B", role: "body" }] });
    body.columnWeights = [1, 1];
    // 先在正文后加一个「尾部」分区
    const tail = insertSectionAfter(doc, { boardId: board.id, sectionId: body.id }, counterIds());
    const doc2 = tail.doc;
    const board2 = doc2.boards[0];
    // 现在在第 2 分区（多列）第一列按 Enter
    const multi = board2.regions[0].sections[1];
    const res = insertSectionAfter(doc2, { boardId: board.id, sectionId: multi.id }, counterIds());
    const board3 = res.doc.boards[0];
    expect(board3.regions[0].sections[1].id).toBe(multi.id);
    expect(board3.regions[0].sections[2].columns).toHaveLength(1); // 新通栏
    expect(board3.regions[0].sections[3].id).toBe(board2.regions[0].sections[2].id); // 尾部顺延
  });
});

describe("insertColumn（左右加号）", () => {
  it("新增列不影响上方标题分区；权重重分（A02）", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    const res = insertColumn(
      doc,
      { boardId: board.id, sectionId: body.id, columnId: body.columns[0].id, side: "right" },
      counterIds(),
    );
    const b2 = res.doc.boards[0];
    expect(b2.regions[0].sections[0].columns).toHaveLength(1); // 标题不受影响
    expect(b2.regions[0].sections[1].columns).toHaveLength(2);
    expect(b2.regions[0].sections[1].columnWeights).toHaveLength(2);
    const newCol = b2.regions[0].sections[1].columns[1];
    expect(res.focus).toMatchObject({ columnId: newCol.id, edit: true });
  });

  it("smart 分区手动加列后转 manual", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns.push({ id: "c2", blocks: [{ id: "ib", type: "image", asset: null, fit: "contain" }] });
    body.columnWeights = [1, 1];
    body.widthMode = "smart";
    const res = insertColumn(
      doc,
      { boardId: board.id, sectionId: body.id, columnId: body.columns[0].id, side: "left" },
      counterIds(),
    );
    expect(res.doc.boards[0].regions[0].sections[1].widthMode).toBe("manual");
  });
});

describe("insertBlockBelow（局部加号）", () => {
  it("只在当前列当前块之后插入，不创建通栏（A04）", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns.push({ id: "col-2", blocks: [{ id: "b2", type: "text", text: "B", role: "body" }] });
    body.columnWeights = [1, 1];
    const res = insertBlockBelow(doc, { blockId: "b2" }, counterIds());
    const b2 = res.doc.boards[0];
    const rightCol = b2.regions[0].sections[1].columns[1];
    expect(rightCol.blocks).toHaveLength(2);
    // 没有新增分区
    expect(b2.regions[0].sections).toHaveLength(2);
    expect(res.focus).toMatchObject({ columnId: rightCol.id, blockId: rightCol.blocks[1].id });
  });

  it("可插入图片块", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    const res = insertBlockBelow(
      doc,
      { blockId: body.columns[0].blocks[0].id, block: { id: "img", type: "image", asset: null, fit: "contain" } },
      counterIds(),
    );
    expect(res.doc.boards[0].regions[0].sections[1].columns[0].blocks[1]).toMatchObject({ type: "image" });
  });
});

describe("splitTextToSection（Enter 拆分）", () => {
  it("光标在中间：后半段迁入新通栏首块（A06）", () => {
    const { doc, board } = docWithBoard();
    const block = board.regions[0].sections[1].columns[0].blocks[0] as { id: string; type: string; text: string };
    block.text = "前半段后半段";
    const res = splitTextToSection(
      doc,
      { blockId: block.id, selectionStart: 3, selectionEnd: 3 },
      counterIds(),
    );
    const b2 = res.doc.boards[0];
    expect((b2.regions[0].sections[1].columns[0].blocks[0] as { text: string }).text).toBe("前半段");
    expect((b2.regions[0].sections[2].columns[0].blocks[0] as { text: string }).text).toBe("后半段");
    expect(res.focus).toMatchObject({ edit: true, caret: "end" });
  });

  it("有选区：选区及其后文字全部迁移，不丢字（A06）", () => {
    const { doc, board } = docWithBoard();
    const block = board.regions[0].sections[1].columns[0].blocks[0] as { id: string; text: string };
    block.text = "ABCDEF";
    const res = splitTextToSection(
      doc,
      { blockId: block.id, selectionStart: 2, selectionEnd: 4 },
      counterIds(),
    );
    const b2 = res.doc.boards[0];
    expect((b2.regions[0].sections[1].columns[0].blocks[0] as { text: string }).text).toBe("AB");
    expect((b2.regions[0].sections[2].columns[0].blocks[0] as { text: string }).text).toBe("CDEF");
  });
});

describe("deleteBlock（A05/A09）", () => {
  it("删除中间块：相邻块聚焦，其余结构不动", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns[0].blocks.push({ id: "a2", type: "text", text: "A2", role: "body" });
    body.columns[0].blocks.push({ id: "a3", type: "text", text: "A3", role: "body" });
    const res = deleteBlock(doc, { blockId: "a2" }, counterIds());
    const col = res.doc.boards[0].regions[0].sections[1].columns[0];
    expect(col.blocks.map((b) => b.id)).toEqual([col.blocks[0].id, "a3"]);
    expect(res.focus).toMatchObject({ blockId: col.blocks[0].id });
  });

  it("删除列内最后一块：空列回收，跨列聚焦；分区空了也回收（A05）", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns.push({ id: "col-2", blocks: [{ id: "b2", type: "text", text: "B", role: "body" }] });
    body.columnWeights = [1, 1];
    // 左列只有一块，删除后左列消失
    const res = deleteBlock(doc, { blockId: body.columns[0].blocks[0].id }, counterIds());
    const b2 = res.doc.boards[0];
    expect(b2.regions[0].sections[1].columns.map((c) => c.id)).toEqual(["col-2"]);
    expect(res.focus).toMatchObject({ columnId: "col-2" });
  });

  it("删光整个分区链：版面保留一个可输入空块，永不空版面（规格 §6.1）", () => {
    const { doc, board } = docWithBoard();
    // 逐个删除正文分区的块，再删除标题块
    let current = doc;
    for (const section of board.regions[0].sections) {
      for (const column of section.columns) {
        for (const block of [...column.blocks]) {
          current = deleteBlock(current, { blockId: block.id }, counterIds()).doc;
        }
      }
    }
    const b2 = current.boards[0];
    expect(b2.regions[0].sections).toHaveLength(1);
    expect(b2.regions[0].sections[0].columns).toHaveLength(1);
    expect(b2.regions[0].sections[0].columns[0].blocks).toHaveLength(1);
    const only = b2.regions[0].sections[0].columns[0].blocks[0];
    expect(only).toMatchObject({ type: "text", role: "body", text: "" });
  });
});

describe("版面尺寸", () => {
  it("resizeBoard 夹在最小/最大宽度之间（A08）", () => {
    const { doc, board } = docWithBoard();
    expect(resizeBoard(doc, { boardId: board.id, width: 100 }).doc.boards[0].width).toBeGreaterThanOrEqual(320);
    expect(resizeBoard(doc, { boardId: board.id, width: 99999 }).doc.boards[0].width).toBeLessThanOrEqual(2000);
    expect(resizeBoard(doc, { boardId: board.id, width: 800 }).doc.boards[0].width).toBe(800);
  });

  it("deleteBoard 移除整张版面", () => {
    const { doc, board } = docWithBoard();
    expect(deleteBoard(doc, { boardId: board.id }).doc.boards).toHaveLength(0);
  });
});

describe("文本与图片属性", () => {
  it("updateTextRole 切换标题/正文并重置字号覆盖", () => {
    const { doc, board } = docWithBoard();
    const block = board.regions[0].sections[1].columns[0].blocks[0] as { id: string };
    updateBlockStyle(doc, { blockId: block.id, style: { fontSize: "xl", bold: true } });
    const doc2 = updateBlockStyle(doc, { blockId: block.id, style: { fontSize: "xl" } }).doc;
    const res = updateTextRole(doc2, { blockId: block.id, role: "title" });
    const b = res.doc.boards[0].regions[0].sections[1].columns[0].blocks[0] as { role: string; style?: Record<string, unknown> };
    expect(b.role).toBe("title");
    expect(b.style?.fontSize).toBeUndefined();
  });

  it("setImageAsset / setImageFit（A07 contain/cover）", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns[0].blocks = [{ id: "img", type: "image", asset: null, fit: "contain" }];
    const asset = { url: "https://example.com/a.png", naturalWidth: 100, naturalHeight: 50 };
    const doc2 = setImageAsset(doc, { blockId: "img", asset }).doc;
    const doc3 = setImageFit(doc2, { blockId: "img", fit: "cover" }).doc;
    expect(doc3.boards[0].regions[0].sections[1].columns[0].blocks[0]).toMatchObject({
      type: "image",
      asset,
      fit: "cover",
    });
  });

  it("updateTextBlock 保留其他块", () => {
    const { doc, board } = docWithBoard();
    const id = board.regions[0].sections[1].columns[0].blocks[0].id;
    const doc2 = updateTextBlock(doc, { blockId: id, text: "hello" }).doc;
    expect((doc2.boards[0].regions[0].sections[1].columns[0].blocks[0] as { text: string }).text).toBe("hello");
    expect(doc2.boards[0].regions[0].sections[0].columns[0].blocks[0].id).toBe(
      board.regions[0].sections[0].columns[0].blocks[0].id,
    );
  });
});

describe("列宽策略", () => {
  it("applyColumnDrag → manual；manual 不被智能重算覆盖；恢复需显式切回（A08）", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns.push({ id: "c2", blocks: [] });
    body.columnWeights = [1, 1];
    const doc2 = applyColumnDrag(doc, {
      boardId: board.id,
      sectionId: body.id,
      boundaryIndex: 0,
      newLeftWidth: 400,
      currentWidths: [288, 288],
    }).doc;
    const s1 = doc2.boards[0].regions[0].sections[1];
    expect(s1.widthMode).toBe("manual");
    expect(s1.columnWeights[0]).toBe(400);
    // manual 分区上自动智能重算是 no-op（手调不被覆盖）
    const s1After = applySmartWeights(doc2, {
      boardId: board.id,
      sectionId: body.id,
      weights: [300, 272],
    }).doc.boards[0].regions[0].sections[1];
    expect(s1After.widthMode).toBe("manual");
    expect(s1After.columnWeights[0]).toBe(400);
    // 用户显式恢复智能比例
    const doc3 = setSectionWidthMode(doc2, {
      boardId: board.id,
      sectionId: body.id,
      mode: "smart",
    }).doc;
    const s2 = applySmartWeights(doc3, {
      boardId: board.id,
      sectionId: body.id,
      weights: [300, 272],
    }).doc.boards[0].regions[0].sections[1];
    expect(s2.widthMode).toBe("smart");
    expect(s2.columnWeights).toEqual([300, 272]);
  });

  it("setSectionWidthMode equal 重置权重", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns.push({ id: "c2", blocks: [] });
    body.columnWeights = [3, 1];
    body.widthMode = "manual";
    const doc2 = setSectionWidthMode(doc, {
      boardId: board.id,
      sectionId: body.id,
      mode: "equal",
    }).doc;
    const s = doc2.boards[0].regions[0].sections[1];
    expect(s).toMatchObject({ widthMode: "equal" });
    expect(s.columnWeights).toEqual([1, 1]);
  });
});

describe("自由容器（A10 结构层）", () => {
  it("创建/移动/改宽/删除；zIndex 递增", () => {
    const newId = counterIds();
    const doc = emptyDoc();
    const r1 = createFreeText(doc, { x: 10, y: 20 }, newId);
    const r2 = createFreeImage(r1.doc, { x: 0, y: 0 }, newId);
    expect(r2.doc.freeItems[1].zIndex).toBe(2);
    const r3 = updateFreeItem(r2.doc, { itemId: r2.doc.freeItems[0].id, x: 99, width: 300 }).doc;
    expect(r3.freeItems[0]).toMatchObject({ x: 99, width: 300 });
    const r4 = deleteFreeItem(r3, { itemId: r3.freeItems[0].id }).doc;
    expect(r4.freeItems).toHaveLength(1);
  });
});

describe("结构完整性", () => {
  it("所有命令不改剩余对象 ID（A09）", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    body.columns.push({ id: "col-2", blocks: [{ id: "b2", type: "text", text: "B", role: "body" }] });
    body.columnWeights = [1, 1];
    const before = [board.id, body.id, body.columns[0].id, "col-2", "b2"];
    const doc2 = insertColumn(
      doc,
      { boardId: board.id, sectionId: body.id, columnId: "col-2", side: "left" },
      counterIds(),
    ).doc;
    const nb = doc2.boards[0];
    expect([nb.id, nb.regions[0].sections[1].id, nb.regions[0].sections[1].columns[0].id, nb.regions[0].sections[1].columns[2].id, "b2"])
      .toEqual(before);
    // padding 不变（BOARD_PADDING 只被引用一次避免 import 报错）
    expect(nb.padding).toBe(BOARD_PADDING);
  });
});

describe("createBoardAutoPlace（A4 视口内落位）", () => {
  const viewport = { x: 5000, y: 5000, width: 1200, height: 800 };

  it("空画布：新版面落在视口矩形左上角", () => {
    const res = createBoardAutoPlace(emptyDoc(), viewport, counterIds());
    const b = res.doc.boards[0];
    expect(b.x).toBe(5000);
    expect(b.y).toBe(5000);
  });

  it("平移到远处：新版面仍落在视口矩形内", () => {
    // 原点已有版面——旧实现会落在 (720,0)，远离当前视口
    const base = createBoard(emptyDoc(), { x: 0, y: 0 }, counterIds()).doc;
    const res = createBoardAutoPlace(base, viewport, counterIds());
    const b = res.doc.boards[1];
    expect(b.x).toBeGreaterThanOrEqual(viewport.x);
    expect(b.y).toBeGreaterThanOrEqual(viewport.y);
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.x + viewport.width);
    expect(b.y).toBeLessThanOrEqual(viewport.y + viewport.height);
  });

  it("视口第一格被自由容器占据：包围盒重叠检测后顺延到下一格", () => {
    const doc = emptyDoc();
    doc.freeItems.push({
      id: "f1",
      x: 5000,
      y: 5000,
      width: 320,
      zIndex: 1,
      block: { id: "fb1", type: "text", text: "占位", role: "body" },
    });
    const res = createBoardAutoPlace(doc, viewport, counterIds());
    const b = res.doc.boards[0];
    expect([b.x, b.y]).not.toEqual([5000, 5000]);
    expect(b.x).toBeGreaterThanOrEqual(viewport.x);
    expect(b.y).toBeGreaterThanOrEqual(viewport.y);
  });

  it("视口被占满：落在视口中心（允许重叠，但必须在视口内）", () => {
    // 700×400 视口只容一个网格格位，用一张版面占住
    const small = { x: 5000, y: 5000, width: 700, height: 400 };
    const base = createBoard(emptyDoc(), { x: 5000, y: 5000 }, counterIds()).doc;
    const res = createBoardAutoPlace(base, small, counterIds());
    const b = res.doc.boards[1];
    expect(b.x).toBeCloseTo(5000 + (700 - BOARD_DEFAULT_WIDTH) / 2, 6);
    expect(b.y).toBeCloseTo(5000 + (400 - 240) / 2, 6);
    expect(b.x).toBeGreaterThanOrEqual(small.x);
    expect(b.y).toBeGreaterThanOrEqual(small.y);
  });

  it("无视口信息：退回原点网格（旧行为）", () => {
    const base = createBoard(emptyDoc(), { x: 0, y: 0 }, counterIds()).doc;
    const res = createBoardAutoPlace(base, null, counterIds());
    expect([res.doc.boards[1].x, res.doc.boards[1].y]).toEqual([720, 0]);
  });
});

describe("工具条图片插入路由（A9 → B2 由 image-insert.ts 取代）", () => {
  it("insertBlockBelow 插入图片块：选中但不进入编辑态", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    const res = insertBlockBelow(
      doc,
      { blockId: body.columns[0].blocks[0].id, block: { id: "img", type: "image", asset: null, fit: "contain" } },
      counterIds(),
    );
    expect(res.doc.boards[0].regions[0].sections[1].columns[0].blocks[1]).toMatchObject({ type: "image" });
    expect(res.focus).toMatchObject({ blockId: "img" });
    expect(res.focus).not.toMatchObject({ edit: true });
  });

  it("updateFreeItemBlock：容器比例 ratio 写入（A5 命令层）", () => {
    const newId = counterIds();
    const doc = createFreeImage(emptyDoc(), { x: 0, y: 0 }, newId).doc;
    const itemId = doc.freeItems[0].id;
    const res = updateFreeItemBlock(doc, { itemId, ratio: "16:9" });
    const block = res.doc.freeItems[0].block;
    expect(block.type).toBe("image");
    if (block.type === "image") expect(block.ratio).toBe("16:9");
  });
});

describe("统一插入命令（B2）", () => {
  it("insertBlockAtTarget column+afterBlockId：插在该块之后并聚焦编辑（文本块）", () => {
    const { doc, board } = docWithBoard();
    const title = board.regions[0].sections[0].columns[0].blocks[0];
    const res = insertBlockAtTarget(
      doc,
      {
        kind: "column",
        boardId: board.id,
        regionId: board.regions[0].id,
        sectionId: board.regions[0].sections[0].id,
        columnId: board.regions[0].sections[0].columns[0].id,
        afterBlockId: title.id,
      },
      { id: "nb", type: "text", text: "", role: "body" },
      counterIds(),
    );
    const blocks = res.doc.boards[0].regions[0].sections[0].columns[0].blocks;
    expect(blocks.map((b) => b.id)).toEqual([title.id, "nb"]);
    expect(res.focus).toMatchObject({ kind: "block", blockId: "nb", edit: true });
  });

  it("insertBlockAtTarget column 无锚点：追加到列末尾", () => {
    const { doc, board } = docWithBoard();
    const section = board.regions[0].sections[0];
    const res = insertBlockAtTarget(
      doc,
      {
        kind: "column",
        boardId: board.id,
        regionId: board.regions[0].id,
        sectionId: section.id,
        columnId: section.columns[0].id,
      },
      { id: "nb", type: "divider" },
      counterIds(),
    );
    const blocks = res.doc.boards[0].regions[0].sections[0].columns[0].blocks;
    expect(blocks[blocks.length - 1]).toMatchObject({ id: "nb", type: "divider" });
    // 分隔线不进入编辑态
    expect(res.focus).toMatchObject({ kind: "block", blockId: "nb" });
    expect(res.focus).not.toMatchObject({ edit: true });
  });

  it("insertBlockAtTarget region-end：区块末尾追加一行（首列放块）", () => {
    const { doc, board } = docWithBoard();
    const region = board.regions[0];
    const res = insertBlockAtTarget(
      doc,
      { kind: "region-end", boardId: board.id, regionId: region.id },
      { id: "nd", type: "button", label: "L", href: "", align: "left", variant: "primary" },
      counterIds(),
    );
    const sections = res.doc.boards[0].regions[0].sections;
    expect(sections).toHaveLength(3);
    expect(sections[2].columns).toHaveLength(1);
    expect(sections[2].columns[0].blocks[0]).toMatchObject({ id: "nd", type: "button" });
  });

  it("insertBlockAtTarget region-end：区块/页面缺失时自动建区块兜底", () => {
    const { doc, board } = docWithBoard();
    const res = insertBlockAtTarget(
      doc,
      { kind: "region-end", boardId: board.id, regionId: "ghost-region" },
      { id: "nb", type: "text", text: "", role: "body" },
      counterIds(),
    );
    const regions = res.doc.boards[0].regions;
    expect(regions).toHaveLength(2);
    expect(regions[1].sections[0].columns[0].blocks[0]).toMatchObject({ id: "nb" });
  });

  it("insertBlockAtTarget column 锚点行已删：兜底追加区块末尾（不丢块）", () => {
    const { doc, board } = docWithBoard();
    const res = insertBlockAtTarget(
      doc,
      {
        kind: "column",
        boardId: board.id,
        regionId: board.regions[0].id,
        sectionId: "ghost-section",
        columnId: "ghost-column",
      },
      { id: "nb", type: "text", text: "", role: "body" },
      counterIds(),
    );
    const regions = res.doc.boards[0].regions;
    expect(regions[0].sections[regions[0].sections.length - 1].columns[0].blocks[0]).toMatchObject({ id: "nb" });
  });

  it("insertRegionAfter：在指定区块之后插入新区块（含可输入空正文行）", () => {
    const { doc, board } = docWithBoard();
    const firstRegion = board.regions[0];
    const res = insertRegionAfter(doc, { boardId: board.id, regionId: firstRegion.id }, counterIds());
    const regions = res.doc.boards[0].regions;
    expect(regions).toHaveLength(2);
    expect(regions[1].sections[0].columns[0].blocks[0]).toMatchObject({ type: "text", role: "body" });
    expect(res.focus).toMatchObject({ kind: "block", edit: true });
  });

  it("removeColumn：仅允许删除空列；非空列与最后一列 no-op", () => {
    const { doc, board } = docWithBoard();
    const body = board.regions[0].sections[1];
    // 加一列（空正文块 = 非空）
    const grown = insertColumn(
      doc,
      { boardId: board.id, sectionId: body.id, columnId: body.columns[0].id, side: "right" },
      counterIds(),
    );
    const body2 = grown.doc.boards[0].regions[0].sections[1];
    expect(body2.columns).toHaveLength(2);
    // 非空列不能删
    const refused = removeColumn(grown.doc, {
      boardId: board.id,
      sectionId: body.id,
      columnId: body2.columns[1].id,
    });
    expect(refused.doc.boards[0].regions[0].sections[1].columns).toHaveLength(2);
    // 删空列：先清空该列块
    const emptied = updateTextBlock(grown.doc, { blockId: body2.columns[1].blocks[0].id, text: "" });
    void emptied;
    const deletedBlock = deleteBlock(grown.doc, { blockId: body2.columns[1].blocks[0].id });
    const body3 = deletedBlock.doc.boards[0].regions[0].sections[1];
    expect(body3.columns).toHaveLength(1); // 空列被 normalize 回收
  });

  it("updateButtonBlock：label/href/align/variant 更新并截断", () => {
    const { doc, board } = docWithBoard();
    const res = insertBlockAtTarget(
      doc,
      { kind: "region-end", boardId: board.id, regionId: board.regions[0].id },
      { id: "btn", type: "button", label: "a", href: "", align: "left", variant: "primary" },
      counterIds(),
    );
    const updated = updateButtonBlock(res.doc, {
      blockId: "btn",
      label: "立即购买",
      href: "https://example.com",
      align: "center",
      variant: "secondary",
    });
    const block = updated.doc.boards[0].regions[0].sections[2].columns[0].blocks[0];
    expect(block).toMatchObject({
      type: "button",
      label: "立即购买",
      href: "https://example.com",
      align: "center",
      variant: "secondary",
    });
  });

  it("updateSectionLayout / setColumnWeights / updateImageBlock / updateBoardPadding", () => {
    const { doc, board } = docWithBoard();
    const section = board.regions[0].sections[0];
    const withLayout = updateSectionLayout(doc, {
      boardId: board.id,
      sectionId: section.id,
      gap: 24,
      verticalAlign: "top",
    });
    const s2 = withLayout.doc.boards[0].regions[0].sections[0];
    expect(s2.gap).toBe(24);
    expect(s2.verticalAlign).toBe("top");

    const weighted = setColumnWeights(withLayout.doc, {
      boardId: board.id,
      sectionId: section.id,
      weights: [2, 1],
    });
    // 列数不符 → no-op（权重不变，不转 manual）
    expect(weighted.doc.boards[0].regions[0].sections[0].columnWeights).toEqual(section.columnWeights);
    expect(weighted.doc.boards[0].regions[0].sections[0].widthMode).toBe(section.widthMode);

    const padded = updateBoardPadding(withLayout.doc, { boardId: board.id, padding: 40 });
    expect(padded.doc.boards[0].padding).toBe(40);

    const img = insertBlockAtTarget(
      padded.doc,
      {
        kind: "column",
        boardId: board.id,
        regionId: board.regions[0].id,
        sectionId: section.id,
        columnId: section.columns[0].id,
      },
      { id: "img", type: "image", asset: null, fit: "contain" },
      counterIds(),
    );
    const withMeta = updateImageBlock(img.doc, { blockId: "img", ratio: "4:3", alt: "说明" });
    const imgBlock = withMeta.doc.boards[0].regions[0].sections[0].columns[0].blocks[1];
    expect(imgBlock.type).toBe("image");
    if (imgBlock.type === "image") {
      expect(imgBlock.ratio).toBe("4:3");
      expect(imgBlock.alt).toBe("说明");
    }
  });
});

describe("createBoardSkeleton（B1 新建页面骨架）", () => {
  it("blank：一个默认区块 + 一个标题块，落位在指定坐标，焦点首标题可编辑", () => {
    const res = createBoardSkeleton(
      emptyDoc(),
      { at: { x: 100, y: 200 }, variant: "blank" },
      counterIds(),
    );
    const b = res.doc.boards[0];
    expect([b.x, b.y]).toEqual([100, 200]);
    expect(b.regions).toHaveLength(1);
    expect(b.regions[0].name).toBe("内容");
    expect(b.regions[0].sections).toHaveLength(1);
    const title = b.regions[0].sections[0].columns[0].blocks[0];
    expect(title).toMatchObject({ type: "text", role: "title", text: "" });
    expect(res.focus).toMatchObject({ kind: "block", edit: true, blockId: title.id });
  });

  it("landing：头部/中部/底部三个区块，占位为提示文字，焦点头部标题", () => {
    const res = createBoardSkeleton(
      emptyDoc(),
      { viewportRect: { x: 5000, y: 5000, width: 1200, height: 800 }, variant: "landing" },
      counterIds(),
    );
    const b = res.doc.boards[0];
    expect(b.regions.map((r) => r.name)).toEqual(["头部", "中部", "底部"]);
    const headTitle = b.regions[0].sections[0].columns[0].blocks[0];
    expect(headTitle).toMatchObject({ type: "text", role: "title", text: "点击输入标题" });
    expect(b.regions[1].sections[0].columns[0].blocks[0]).toMatchObject({ type: "text", text: "点击输入正文" });
    expect(b.regions[2].sections[0].columns[0].blocks[0]).toMatchObject({ type: "text", text: "点击输入底部内容" });
    expect(res.focus).toMatchObject({ kind: "block", blockId: headTitle.id, edit: true });
  });

  it("无视口无 at：退回原点网格（A 阶段落位逻辑沿用）", () => {
    const res = createBoardSkeleton(emptyDoc(), { viewportRect: null, variant: "blank" }, counterIds());
    expect([res.doc.boards[0].x, res.doc.boards[0].y]).toEqual([0, 0]);
  });
});

describe("区块命令（B1）", () => {
  function docWithTwoRegions() {
    const { doc, board } = docWithBoard();
    const r2 = createBoardSkeleton(doc, { at: { x: 0, y: 0 }, variant: "blank" }, counterIds()).doc.boards[1].regions[0];
    board.regions.push(structuredClone(r2));
    board.regions[1].id = "region-b";
    board.regions[1].name = "第二区块";
    return { doc, board };
  }

  it("renameRegion：改名并截断超长；空名归一为默认「内容」", () => {
    const { doc, board } = docWithTwoRegions();
    const regionId = board.regions[0].id;
    const res = renameRegion(doc, { boardId: board.id, regionId, name: "  头部  " });
    expect(res.doc.boards[0].regions[0].name).toBe("头部");
    expect(res.focus).toMatchObject({ kind: "region", regionId });
    const long = renameRegion(doc, { boardId: board.id, regionId, name: "x".repeat(150) });
    expect(long.doc.boards[0].regions[0].name).toHaveLength(100);
    const empty = renameRegion(doc, { boardId: board.id, regionId, name: "   " });
    expect(empty.doc.boards[0].regions[0].name).toBe("内容");
  });

  it("renameBoard：页面名写入/清空归一", () => {
    const { doc, board } = docWithBoard();
    expect(renameBoard(doc, { boardId: board.id, name: "落地页" }).doc.boards[0].name).toBe("落地页");
    const cleared = renameBoard(doc, { boardId: board.id, name: " " }).doc.boards[0];
    expect(cleared.name).toBeUndefined();
  });

  it("moveRegion：与相邻区块交换，越界 no-op 且保留选中", () => {
    const { doc, board } = docWithTwoRegions();
    const [a, b] = board.regions.map((r) => r.id);
    const down = moveRegion(doc, { boardId: board.id, regionId: a, direction: "down" });
    expect(down.doc.boards[0].regions.map((r) => r.id)).toEqual([b, a]);
    expect(down.focus).toMatchObject({ kind: "region", regionId: a });
    const up = moveRegion(doc, { boardId: board.id, regionId: a, direction: "up" });
    expect(up.doc.boards[0].regions.map((r) => r.id)).toEqual([a, b]);
    const noop = moveRegion(doc, { boardId: board.id, regionId: a, direction: "up" });
    expect(noop.doc).toEqual(doc); // 已是首位：结构不动
  });

  it("duplicateRegion：插在原区块后，内容逐字段保留、全部子对象换新 ID", () => {
    const newId = counterIds();
    const res1 = createBoard(emptyDoc(), { x: 0, y: 0 }, newId);
    const board = res1.doc.boards[0];
    board.regions[0].name = "头部";
    const res = duplicateRegion(res1.doc, { boardId: board.id, regionId: board.regions[0].id }, newId);
    const regions = res.doc.boards[0].regions;
    expect(regions).toHaveLength(2);
    expect(regions[0].id).toBe(board.regions[0].id);
    expect(regions[1].name).toBe("头部");
    expect(regions[1].id).not.toBe(regions[0].id);
    expect(regions[1].sections).toHaveLength(2);
    // 与原区块（同一结果文档内）逐层比较：结构/内容相等，ID 全部不同
    for (let si = 0; si < 2; si += 1) {
      expect(regions[1].sections[si].id).not.toBe(regions[0].sections[si].id);
      expect(regions[1].sections[si].widthMode).toBe(regions[0].sections[si].widthMode);
      expect(regions[1].sections[si].columnWeights).toEqual(regions[0].sections[si].columnWeights);
      regions[0].sections[si].columns.forEach((col, ci) => {
        const cloneCol = regions[1].sections[si].columns[ci];
        expect(cloneCol.id).not.toBe(col.id);
        col.blocks.forEach((blk, ki) => {
          const cloneBlk = cloneCol.blocks[ki];
          expect(cloneBlk.id).not.toBe(blk.id);
          expect({ ...cloneBlk, id: blk.id }).toEqual(blk);
        });
      });
    }
    expect(res.focus).toMatchObject({ kind: "region", regionId: regions[1].id });
  });

  it("deleteRegion：删除后版面保留一个可输入空块（normalize 语义扩展到区块层）", () => {
    const { doc, board } = docWithTwoRegions();
    const res = deleteRegion(doc, { boardId: board.id, regionId: board.regions[0].id }, counterIds());
    const b = res.doc.boards[0];
    expect(b.regions).toHaveLength(1);
    expect(b.regions[0].id).toBe("region-b");
    // 删光全部区块 → 保底空块
    const empty = deleteRegion(res.doc, { boardId: board.id, regionId: "region-b" }, counterIds());
    const b2 = empty.doc.boards[0];
    expect(b2.regions).toHaveLength(1);
    expect(b2.regions[0].sections[0].columns[0].blocks[0]).toMatchObject({ type: "text", role: "body", text: "" });
  });

  it("splitTextToSection 不跨区块：Enter 新增行留在当前区块内", () => {
    const { doc, board } = docWithTwoRegions();
    const block = board.regions[0].sections[0].columns[0].blocks[0] as { id: string; text: string };
    block.text = "前后";
    const res = splitTextToSection(doc, { blockId: block.id, selectionStart: 1, selectionEnd: 1 }, counterIds());
    const regions = res.doc.boards[0].regions;
    expect(regions[0].sections).toHaveLength(3); // 原 2 行 + 本区块内新增一行（不跨区块）
    expect(regions[1].sections).toHaveLength(1); // 第二区块不受影响
    expect((regions[0].sections[0].columns[0].blocks[0] as { text: string }).text).toBe("前");
    expect((regions[0].sections[1].columns[0].blocks[0] as { text: string }).text).toBe("后");
  });
});

describe("attachFreeItemToRegion（B1 自由对象移入区块）", () => {
  function docWithFreeText() {
    const newId = counterIds();
    const base = createFreeText(emptyDoc(), { x: 5, y: 6 }, newId).doc;
    const withBoard = createBoard(base, { x: 0, y: 100 }, newId).doc;
    return { doc: withBoard, itemId: base.freeItems[0].id, board: withBoard.boards[0] };
  }

  it("默认：区块末尾新建一行，自由对象移除，焦点新块", () => {
    const { doc, itemId, board } = docWithFreeText();
    const regionId = board.regions[0].id;
    const before = board.regions[0].sections.length;
    const res = attachFreeItemToRegion(doc, { freeItemId: itemId, boardId: board.id, regionId });
    expect(res.doc.freeItems).toHaveLength(0);
    const region = res.doc.boards[0].regions[0];
    expect(region.sections).toHaveLength(before + 1);
    const block = region.sections[region.sections.length - 1].columns[0].blocks[0];
    expect(block).toMatchObject({ type: "text", text: "" });
    expect(res.focus).toMatchObject({ kind: "block", blockId: block.id });
  });

  it("指定 columnId：追加到该列末尾，不产生新行", () => {
    const { doc, itemId, board } = docWithFreeText();
    const region = board.regions[0];
    const targetSection = region.sections[0];
    const targetColumn = targetSection.columns[0];
    const res = attachFreeItemToRegion(doc, {
      freeItemId: itemId,
      boardId: board.id,
      regionId: region.id,
      sectionId: targetSection.id,
      columnId: targetColumn.id,
    });
    const col = res.doc.boards[0].regions[0].sections[0].columns[0];
    expect(col.blocks).toHaveLength(2);
    expect(res.doc.boards[0].regions[0].sections).toHaveLength(2); // 行数不变
  });

  it("只指定 sectionId：在该行加一列（权重均值，smart 转 manual）", () => {
    const { doc, itemId, board } = docWithFreeText();
    const region = board.regions[0];
    const targetSection = region.sections[0];
    const res = attachFreeItemToRegion(doc, {
      freeItemId: itemId,
      boardId: board.id,
      regionId: region.id,
      sectionId: targetSection.id,
    });
    const section = res.doc.boards[0].regions[0].sections[0];
    expect(section.columns).toHaveLength(2);
    expect(section.columnWeights).toHaveLength(2);
  });

  it("原文档不被修改（纯函数，可撤销由历史保证）", () => {
    const { doc, itemId, board } = docWithFreeText();
    const snapshot = structuredClone(doc);
    attachFreeItemToRegion(doc, { freeItemId: itemId, boardId: board.id, regionId: board.regions[0].id });
    expect(doc).toEqual(snapshot);
  });
});

describe("块级复制/上移/下移（B1 补齐）", () => {
  it("duplicateBlock：同列其后插入深克隆（新 ID），文本块进入编辑", () => {
    const { doc, board } = docWithBoard();
    const col = board.regions[0].sections[1].columns[0];
    col.blocks.push({ id: "b2", type: "text", text: "B", role: "body" });
    const res = duplicateBlock(doc, { blockId: "b2" }, counterIds());
    const blocks = res.doc.boards[0].regions[0].sections[1].columns[0].blocks;
    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toMatchObject({ type: "text", text: "B", role: "body" });
    expect(blocks[2].id).not.toBe("b2");
    expect(res.focus).toMatchObject({ kind: "block", blockId: blocks[2].id, edit: true });
  });

  it("moveBlock：列内交换；越界 no-op", () => {
    const { doc, board } = docWithBoard();
    const col = board.regions[0].sections[1].columns[0];
    const firstId = col.blocks[0].id;
    col.blocks.push({ id: "b2", type: "text", text: "B", role: "body" });
    col.blocks.push({ id: "b3", type: "text", text: "C", role: "body" });
    const idsOf = (d: typeof doc) => d.boards[0].regions[0].sections[1].columns[0].blocks.map((b) => b.id);
    const up = moveBlock(doc, { blockId: "b3", direction: "up" });
    expect(idsOf(up.doc)).toEqual([firstId, "b3", "b2"]);
    expect(up.focus).toMatchObject({ kind: "block", blockId: "b3" });
    const noop = moveBlock(doc, { blockId: firstId, direction: "up" });
    expect(idsOf(noop.doc)).toEqual([firstId, "b2", "b3"]);
    const down = moveBlock(doc, { blockId: "b2", direction: "down" });
    expect(idsOf(down.doc)).toEqual([firstId, "b3", "b2"]);
  });
});

describe("applyCanvasTemplate（B1 模板）", () => {
  it("四项模板结构：空白结构/图文介绍/三列卖点/行动区，占位为提示文字", () => {
    const newId = counterIds();
    const res1 = createBoard(emptyDoc(), { x: 0, y: 0 }, newId);
    const doc = res1.doc;
    const board = doc.boards[0];
    const cases: Array<[Parameters<typeof applyCanvasTemplate>[1]["template"], string, number, number]> = [
      ["blank-structure", "空白结构", 1, 1],
      ["image-text", "图文介绍", 1, 2],
      ["three-columns", "三列卖点", 1, 3],
      ["cta", "行动区", 1, 1],
    ];
    let current = doc;
    for (const [template, name, sectionCount, columnCount] of cases) {
      const res = applyCanvasTemplate(current, { boardId: board.id, template }, newId);
      current = res.doc;
      const region = current.boards[0].regions[current.boards[0].regions.length - 1];
      expect(region.name).toBe(name);
      expect(region.sections).toHaveLength(sectionCount);
      expect(region.sections[0].columns).toHaveLength(columnCount);
      expect(res.focus).toMatchObject({ kind: "region", regionId: region.id });
    }
    const cta = current.boards[0].regions[current.boards[0].regions.length - 1];
    expect(cta.sections[0].columns[0].blocks[0]).toMatchObject({
      type: "text",
      text: "点击输入行动号召文字",
      style: { align: "center" },
    });
    const three = current.boards[0].regions[current.boards[0].regions.length - 2];
    for (const column of three.sections[0].columns) {
      expect(column.blocks[0]).toMatchObject({ type: "text", role: "title", text: "点击输入标题" });
      expect(column.blocks[1]).toMatchObject({ type: "text", role: "body", text: "点击输入正文" });
    }
    const imageText = current.boards[0].regions[current.boards[0].regions.length - 3];
    expect(imageText.sections[0].columns[1].blocks[0]).toMatchObject({ type: "image", asset: null });
  });
});
