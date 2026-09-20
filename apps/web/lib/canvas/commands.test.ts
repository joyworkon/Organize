import { describe, expect, it } from "vitest";
import {
  BOARD_DEFAULT_WIDTH,
  BOARD_PADDING,
  createBoardShape,
  emptyDoc,
} from "./model";
import {
  applyColumnDrag,
  applySmartWeights,
  createBoard,
  createFreeImage,
  createFreeText,
  deleteBlock,
  deleteBoard,
  deleteFreeItem,
  insertBlockBelow,
  insertColumn,
  insertSectionAfter,
  resizeBoard,
  setSectionWidthMode,
  setImageAsset,
  setImageFit,
  splitTextToSection,
  updateBlockStyle,
  updateFreeItem,
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
    const first = b.sections[0].columns[0].blocks[0];
    expect(first).toMatchObject({ type: "text", role: "title" });
    expect(res.focus).toMatchObject({ kind: "block", blockId: first.id, edit: true });
    // 原文档不被修改（纯函数）
    expect(doc.boards).toHaveLength(0);
  });
});

describe("insertSectionAfter（Enter / 添加通栏）", () => {
  it("标题分区 Enter：标题宽度不变，新正文分区在下方（A02）", () => {
    const { doc, board } = docWithBoard();
    const titleSection = board.sections[0];
    const res = insertSectionAfter(
      doc,
      { boardId: board.id, sectionId: titleSection.id },
      counterIds(),
    );
    const b2 = res.doc.boards[0];
    expect(b2.sections).toHaveLength(3);
    expect(b2.sections[0].id).toBe(titleSection.id);
    expect(b2.sections[0].columns).toHaveLength(1); // 标题仍通栏
    const newBlock = b2.sections[1].columns[0].blocks[0];
    expect(newBlock).toMatchObject({ type: "text", role: "body" });
    expect(res.focus).toMatchObject({ blockId: newBlock.id });
  });

  it("多列分区中间 Enter：新通栏插在整个分区之后，后续分区顺延（A03）", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    body.columns.push({ id: "col-2", blocks: [{ id: "b2", type: "text", text: "B", role: "body" }] });
    body.columnWeights = [1, 1];
    // 先在正文后加一个「尾部」分区
    const tail = insertSectionAfter(doc, { boardId: board.id, sectionId: body.id }, counterIds());
    const doc2 = tail.doc;
    const board2 = doc2.boards[0];
    // 现在在第 2 分区（多列）第一列按 Enter
    const multi = board2.sections[1];
    const res = insertSectionAfter(doc2, { boardId: board.id, sectionId: multi.id }, counterIds());
    const board3 = res.doc.boards[0];
    expect(board3.sections[1].id).toBe(multi.id);
    expect(board3.sections[2].columns).toHaveLength(1); // 新通栏
    expect(board3.sections[3].id).toBe(board2.sections[2].id); // 尾部顺延
  });
});

describe("insertColumn（左右加号）", () => {
  it("新增列不影响上方标题分区；权重重分（A02）", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    const res = insertColumn(
      doc,
      { boardId: board.id, sectionId: body.id, columnId: body.columns[0].id, side: "right" },
      counterIds(),
    );
    const b2 = res.doc.boards[0];
    expect(b2.sections[0].columns).toHaveLength(1); // 标题不受影响
    expect(b2.sections[1].columns).toHaveLength(2);
    expect(b2.sections[1].columnWeights).toHaveLength(2);
    const newCol = b2.sections[1].columns[1];
    expect(res.focus).toMatchObject({ columnId: newCol.id, edit: true });
  });

  it("smart 分区手动加列后转 manual", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    body.columns.push({ id: "c2", blocks: [{ id: "ib", type: "image", asset: null, fit: "contain" }] });
    body.columnWeights = [1, 1];
    body.widthMode = "smart";
    const res = insertColumn(
      doc,
      { boardId: board.id, sectionId: body.id, columnId: body.columns[0].id, side: "left" },
      counterIds(),
    );
    expect(res.doc.boards[0].sections[1].widthMode).toBe("manual");
  });
});

describe("insertBlockBelow（局部加号）", () => {
  it("只在当前列当前块之后插入，不创建通栏（A04）", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    body.columns.push({ id: "col-2", blocks: [{ id: "b2", type: "text", text: "B", role: "body" }] });
    body.columnWeights = [1, 1];
    const res = insertBlockBelow(doc, { blockId: "b2" }, counterIds());
    const b2 = res.doc.boards[0];
    const rightCol = b2.sections[1].columns[1];
    expect(rightCol.blocks).toHaveLength(2);
    // 没有新增分区
    expect(b2.sections).toHaveLength(2);
    expect(res.focus).toMatchObject({ columnId: rightCol.id, blockId: rightCol.blocks[1].id });
  });

  it("可插入图片块", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    const res = insertBlockBelow(
      doc,
      { blockId: body.columns[0].blocks[0].id, block: { id: "img", type: "image", asset: null, fit: "contain" } },
      counterIds(),
    );
    expect(res.doc.boards[0].sections[1].columns[0].blocks[1]).toMatchObject({ type: "image" });
  });
});

describe("splitTextToSection（Enter 拆分）", () => {
  it("光标在中间：后半段迁入新通栏首块（A06）", () => {
    const { doc, board } = docWithBoard();
    const block = board.sections[1].columns[0].blocks[0] as { id: string; type: string; text: string };
    block.text = "前半段后半段";
    const res = splitTextToSection(
      doc,
      { blockId: block.id, selectionStart: 3, selectionEnd: 3 },
      counterIds(),
    );
    const b2 = res.doc.boards[0];
    expect((b2.sections[1].columns[0].blocks[0] as { text: string }).text).toBe("前半段");
    expect((b2.sections[2].columns[0].blocks[0] as { text: string }).text).toBe("后半段");
    expect(res.focus).toMatchObject({ edit: true, caret: "end" });
  });

  it("有选区：选区及其后文字全部迁移，不丢字（A06）", () => {
    const { doc, board } = docWithBoard();
    const block = board.sections[1].columns[0].blocks[0] as { id: string; text: string };
    block.text = "ABCDEF";
    const res = splitTextToSection(
      doc,
      { blockId: block.id, selectionStart: 2, selectionEnd: 4 },
      counterIds(),
    );
    const b2 = res.doc.boards[0];
    expect((b2.sections[1].columns[0].blocks[0] as { text: string }).text).toBe("AB");
    expect((b2.sections[2].columns[0].blocks[0] as { text: string }).text).toBe("CDEF");
  });
});

describe("deleteBlock（A05/A09）", () => {
  it("删除中间块：相邻块聚焦，其余结构不动", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    body.columns[0].blocks.push({ id: "a2", type: "text", text: "A2", role: "body" });
    body.columns[0].blocks.push({ id: "a3", type: "text", text: "A3", role: "body" });
    const res = deleteBlock(doc, { blockId: "a2" }, counterIds());
    const col = res.doc.boards[0].sections[1].columns[0];
    expect(col.blocks.map((b) => b.id)).toEqual([col.blocks[0].id, "a3"]);
    expect(res.focus).toMatchObject({ blockId: col.blocks[0].id });
  });

  it("删除列内最后一块：空列回收，跨列聚焦；分区空了也回收（A05）", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    body.columns.push({ id: "col-2", blocks: [{ id: "b2", type: "text", text: "B", role: "body" }] });
    body.columnWeights = [1, 1];
    // 左列只有一块，删除后左列消失
    const res = deleteBlock(doc, { blockId: body.columns[0].blocks[0].id }, counterIds());
    const b2 = res.doc.boards[0];
    expect(b2.sections[1].columns.map((c) => c.id)).toEqual(["col-2"]);
    expect(res.focus).toMatchObject({ columnId: "col-2" });
  });

  it("删光整个分区链：版面保留一个可输入空块，永不空版面（规格 §6.1）", () => {
    const { doc, board } = docWithBoard();
    // 逐个删除正文分区的块，再删除标题块
    let current = doc;
    for (const section of board.sections) {
      for (const column of section.columns) {
        for (const block of [...column.blocks]) {
          current = deleteBlock(current, { blockId: block.id }, counterIds()).doc;
        }
      }
    }
    const b2 = current.boards[0];
    expect(b2.sections).toHaveLength(1);
    expect(b2.sections[0].columns).toHaveLength(1);
    expect(b2.sections[0].columns[0].blocks).toHaveLength(1);
    const only = b2.sections[0].columns[0].blocks[0];
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
    const block = board.sections[1].columns[0].blocks[0] as { id: string };
    updateBlockStyle(doc, { blockId: block.id, style: { fontSize: "xl", bold: true } });
    const doc2 = updateBlockStyle(doc, { blockId: block.id, style: { fontSize: "xl" } }).doc;
    const res = updateTextRole(doc2, { blockId: block.id, role: "title" });
    const b = res.doc.boards[0].sections[1].columns[0].blocks[0] as { role: string; style?: Record<string, unknown> };
    expect(b.role).toBe("title");
    expect(b.style?.fontSize).toBeUndefined();
  });

  it("setImageAsset / setImageFit（A07 contain/cover）", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    body.columns[0].blocks = [{ id: "img", type: "image", asset: null, fit: "contain" }];
    const asset = { url: "https://example.com/a.png", naturalWidth: 100, naturalHeight: 50 };
    const doc2 = setImageAsset(doc, { blockId: "img", asset }).doc;
    const doc3 = setImageFit(doc2, { blockId: "img", fit: "cover" }).doc;
    expect(doc3.boards[0].sections[1].columns[0].blocks[0]).toMatchObject({
      type: "image",
      asset,
      fit: "cover",
    });
  });

  it("updateTextBlock 保留其他块", () => {
    const { doc, board } = docWithBoard();
    const id = board.sections[1].columns[0].blocks[0].id;
    const doc2 = updateTextBlock(doc, { blockId: id, text: "hello" }).doc;
    expect((doc2.boards[0].sections[1].columns[0].blocks[0] as { text: string }).text).toBe("hello");
    expect(doc2.boards[0].sections[0].columns[0].blocks[0].id).toBe(
      board.sections[0].columns[0].blocks[0].id,
    );
  });
});

describe("列宽策略", () => {
  it("applyColumnDrag → manual；manual 不被智能重算覆盖；恢复需显式切回（A08）", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    body.columns.push({ id: "c2", blocks: [] });
    body.columnWeights = [1, 1];
    const doc2 = applyColumnDrag(doc, {
      boardId: board.id,
      sectionId: body.id,
      boundaryIndex: 0,
      newLeftWidth: 400,
      currentWidths: [288, 288],
    }).doc;
    const s1 = doc2.boards[0].sections[1];
    expect(s1.widthMode).toBe("manual");
    expect(s1.columnWeights[0]).toBe(400);
    // manual 分区上自动智能重算是 no-op（手调不被覆盖）
    const s1After = applySmartWeights(doc2, {
      boardId: board.id,
      sectionId: body.id,
      weights: [300, 272],
    }).doc.boards[0].sections[1];
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
    }).doc.boards[0].sections[1];
    expect(s2.widthMode).toBe("smart");
    expect(s2.columnWeights).toEqual([300, 272]);
  });

  it("setSectionWidthMode equal 重置权重", () => {
    const { doc, board } = docWithBoard();
    const body = board.sections[1];
    body.columns.push({ id: "c2", blocks: [] });
    body.columnWeights = [3, 1];
    body.widthMode = "manual";
    const doc2 = setSectionWidthMode(doc, {
      boardId: board.id,
      sectionId: body.id,
      mode: "equal",
    }).doc;
    const s = doc2.boards[0].sections[1];
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
    const body = board.sections[1];
    body.columns.push({ id: "col-2", blocks: [{ id: "b2", type: "text", text: "B", role: "body" }] });
    body.columnWeights = [1, 1];
    const before = [board.id, body.id, body.columns[0].id, "col-2", "b2"];
    const doc2 = insertColumn(
      doc,
      { boardId: board.id, sectionId: body.id, columnId: "col-2", side: "left" },
      counterIds(),
    ).doc;
    const nb = doc2.boards[0];
    expect([nb.id, nb.sections[1].id, nb.sections[1].columns[0].id, nb.sections[1].columns[2].id, "b2"])
      .toEqual(before);
    // padding 不变（BOARD_PADDING 只被引用一次避免 import 报错）
    expect(nb.padding).toBe(BOARD_PADDING);
  });
});
