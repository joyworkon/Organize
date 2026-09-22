import { describe, expect, it } from "vitest";
import { emptyDoc, findFreeItem } from "@/lib/canvas/model";
import {
  createBoard,
  createFreeImage,
  createFreeText,
  updateBoardStyle,
  updateFreeItemBlock,
} from "@/lib/canvas/commands";
import { createCanvasStore } from "./canvas-store";

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function makeStore() {
  return createCanvasStore({ doc: emptyDoc() });
}

describe("apply 焦点同步（A1）", () => {
  it("free 焦点：selection 切到新自由容器，不进入编辑态", () => {
    const store = makeStore();
    store.getState().apply("新建自由文本", (d) => createFreeText(d, { x: 10, y: 10 }));
    const itemId = store.getState().doc.freeItems[0].id;
    expect(store.getState().selection).toEqual({ kind: "free", itemId });
    expect(store.getState().editingBlockId).toBeNull();
  });

  it("board 焦点：selection 切到版面", () => {
    const store = makeStore();
    store.getState().apply("新建版面", (d) => createBoard(d, { x: 0, y: 0 }, counterIds()));
    const boardId = store.getState().doc.boards[0].id;
    store.getState().apply("版面背景", (d) =>
      updateBoardStyle(d, { boardId, style: { background: "gray" } }),
    );
    expect(store.getState().selection).toEqual({ kind: "board", boardId });
  });

  it("block 焦点保持原行为：选中新块，edit 时进入编辑态", () => {
    const store = makeStore();
    store.getState().apply("新建版面", (d) => createBoard(d, { x: 0, y: 0 }, counterIds()));
    const titleId = store.getState().doc.boards[0].sections[0].columns[0].blocks[0].id;
    expect(store.getState().selection).toEqual({ kind: "block", blockId: titleId });
    expect(store.getState().editingBlockId).toBe(titleId);
  });

  it("新建自由图片后 selection 指向新容器（previewUrl 键到正确 id 的前提）", () => {
    const store = makeStore();
    store.getState().apply("新建自由图片", (d) => createFreeImage(d, { x: 0, y: 0 }));
    const itemId = store.getState().doc.freeItems[0].id;
    expect(store.getState().selection).toEqual({ kind: "free", itemId });
  });
});

describe("startEdit 对象类别判定（A2）", () => {
  it("自由文本：selection 保持 {kind:'free'}，editingBlockId 指向容器", () => {
    const store = makeStore();
    store.getState().apply("新建自由文本", (d) => createFreeText(d, { x: 0, y: 0 }));
    const itemId = store.getState().doc.freeItems[0].id;
    // 模拟 addFreeText：apply 后读 selection 再 startEdit
    const sel = store.getState().selection;
    if (sel?.kind === "free") store.getState().startEdit(sel.itemId);
    expect(store.getState().editingBlockId).toBe(itemId);
    expect(store.getState().selection).toEqual({ kind: "free", itemId });
    // 属性栏 free 分支按 findFreeItem 解析，不再落入占位文案
    const item = findFreeItem(store.getState().doc, itemId);
    expect(item?.block.type).toBe("text");
  });

  it("版面模块：selection 为 {kind:'block'}", () => {
    const store = makeStore();
    store.getState().apply("新建版面", (d) => createBoard(d, { x: 0, y: 0 }, counterIds()));
    const titleId = store.getState().doc.boards[0].sections[0].columns[0].blocks[0].id;
    store.getState().startEdit(titleId);
    expect(store.getState().selection).toEqual({ kind: "block", blockId: titleId });
    expect(store.getState().editingBlockId).toBe(titleId);
  });
});

describe("自由容器样式命令路径（A3 属性栏依赖）", () => {
  it("updateFreeItemBlock 可写自由文本样式与角色（属性栏自由分支共用）", () => {
    const store = makeStore();
    store.getState().apply("新建自由文本", (d) => createFreeText(d, { x: 0, y: 0 }));
    const itemId = store.getState().doc.freeItems[0].id;
    store.getState().apply("字号", (d) =>
      updateFreeItemBlock(d, { itemId, style: { fontSize: "lg", bold: true, align: "center", color: "red" } }),
    );
    const block = findFreeItem(store.getState().doc, itemId)?.block;
    expect(block?.type).toBe("text");
    if (block?.type === "text") {
      expect(block.style).toMatchObject({ fontSize: "lg", bold: true, align: "center", color: "red" });
    }
  });
});
