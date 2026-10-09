import { describe, expect, it } from "vitest";
import { emptyDoc, findFreeItem } from "@/lib/canvas/model";
import {
  applyCanvasTemplate,
  createBoard,
  createFreeImage,
  createFreeText,
  updateBoardStyle,
  updateFreeItemBlock,
  insertBlockBelow,
  deleteFreeItem,
  deleteBoard,
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
    const titleId = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[0].id;
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
    const titleId = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[0].id;
    store.getState().startEdit(titleId);
    expect(store.getState().selection).toEqual({ kind: "block", blockId: titleId });
    expect(store.getState().editingBlockId).toBe(titleId);
  });
});

describe("编辑与历史保持同一个有效对象", () => {
  it("旧快照的保存响应更新 revision，但不能把后续输入标记为已保存", () => {
    const store = makeStore();
    store.getState().setTitle("第一版");
    const seq = store.getState().localSeq;
    store.getState().setTitle("保存期间继续输入");
    store.getState().markSaved(2, seq);
    expect(store.getState().revision).toBe(2);
    expect(store.getState().saveStatus).toBe("saving");
    store.getState().markSaved(3, store.getState().localSeq);
    expect(store.getState().saveStatus).toBe("saved");
  });
  it("自由文本输入不退出编辑，撤销重做保持自由选区与焦点", () => {
    const store = makeStore();
    store.getState().apply("新建自由文本", (d) => createFreeText(d, { x: 0, y: 0 }));
    const id = store.getState().doc.freeItems[0].id;
    store.getState().startEdit(id);
    store.getState().apply("输入", (d) => updateFreeItemBlock(d, { itemId: id, text: "完整输入" }));
    expect(store.getState().editingBlockId).toBe(id);
    store.getState().undo();
    expect(store.getState().selection).toEqual({ kind: "free", itemId: id });
    expect(store.getState().editingBlockId).toBe(id);
    store.getState().redo();
    expect(store.getState().doc.freeItems[0].block).toMatchObject({ text: "完整输入" });
    expect(store.getState().selection).toEqual({ kind: "free", itemId: id });
    expect(store.getState().editingBlockId).toBe(id);
  });

  it("新模块聚焦后，旧模块迟到的 blur 不清除新焦点", () => {
    const store = makeStore();
    store.getState().apply("建页面", (d) => createBoard(d, { x: 0, y: 0 }));
    const oldId = store.getState().editingBlockId!;
    store.getState().apply("加模块", (d) => insertBlockBelow(d, { blockId: oldId }));
    const newId = store.getState().editingBlockId!;
    expect(newId).not.toBe(oldId);
    store.getState().stopEdit(oldId);
    expect(store.getState().editingBlockId).toBe(newId);
    store.getState().undo();
    expect(store.getState().editingBlockId).toBe(oldId);
    expect(store.getState().selection).toEqual({ kind: "block", blockId: oldId });
    store.getState().redo();
    expect(store.getState().editingBlockId).toBe(newId);
    expect(store.getState().selection).toEqual({ kind: "block", blockId: newId });
  });

  it("删除当前对象后不会残留选区/编辑态，撤销恢复", () => {
    const store = makeStore();
    store.getState().apply("建自由文本", (d) => createFreeText(d, { x: 0, y: 0 }));
    const id = store.getState().doc.freeItems[0].id;
    store.getState().startEdit(id);
    store.getState().apply("删除", (d) => deleteFreeItem(d, { itemId: id }));
    expect(store.getState().selection).toBeNull();
    expect(store.getState().editingBlockId).toBeNull();
    store.getState().undo();
    expect(store.getState().selection).toEqual({ kind: "free", itemId: id });
    expect(store.getState().editingBlockId).toBe(id);
    store.getState().apply("建页面", (d) => createBoard(d, { x: 0, y: 0 }));
    const boardId = store.getState().doc.boards[0].id;
    store.getState().apply("删页面", (d) => deleteBoard(d, { boardId }));
    expect(store.getState().selection).toBeNull();
    expect(store.getState().editingBlockId).toBeNull();
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

describe("region 焦点同步（B1）", () => {
  it("region 焦点：selection 切到新区块，不进入编辑态", () => {
    const store = makeStore();
    store.getState().apply("新建版面", (d) => createBoard(d, { x: 0, y: 0 }, counterIds()));
    const boardId = store.getState().doc.boards[0].id;
    const regionId = store.getState().doc.boards[0].regions[0].id;
    store.getState().apply("插入模板", (d) =>
      applyCanvasTemplate(d, { boardId, template: "blank-structure" }, counterIds()),
    );
    const regions = store.getState().doc.boards[0].regions;
    const newRegionId = regions[regions.length - 1].id;
    expect(newRegionId).not.toBe(regionId);
    expect(store.getState().selection).toEqual({ kind: "region", boardId, regionId: newRegionId });
    expect(store.getState().editingBlockId).toBeNull();
  });
});

describe("lastActiveTarget 最近有效落点（B2 统一插入规则 6）", () => {
  it("apply 块焦点后记录页面+区块", () => {
    const store = makeStore();
    store.getState().apply("新建版面", (d) => createBoard(d, { x: 0, y: 0 }, counterIds()));
    const boardId = store.getState().doc.boards[0].id;
    const regionId = store.getState().doc.boards[0].regions[0].id;
    expect(store.getState().lastActiveTarget).toEqual({ boardId, regionId });
  });

  it("select 选中区块/页面/块时更新；选中自由容器不改变", () => {
    const store = makeStore();
    store.getState().apply("新建版面", (d) => createBoard(d, { x: 0, y: 0 }, counterIds()));
    const boardId = store.getState().doc.boards[0].id;
    const regionId = store.getState().doc.boards[0].regions[0].id;

    store.getState().apply("插入模板", (d) =>
      applyCanvasTemplate(d, { boardId, template: "blank-structure" }, counterIds()),
    );
    const region2 = store.getState().doc.boards[0].regions[1].id;
    store.getState().select({ kind: "region", boardId, regionId: region2 });
    expect(store.getState().lastActiveTarget).toEqual({ boardId, regionId: region2 });

    store.getState().apply("新建自由文本", (d) => createFreeText(d, { x: 0, y: 0 }, counterIds()));
    store.getState().select({ kind: "free", itemId: store.getState().doc.freeItems[0].id });
    // 自由容器选区不改变页面/区块记忆
    expect(store.getState().lastActiveTarget).toEqual({ boardId, regionId: region2 });

    const blockId = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[0].id;
    store.getState().select({ kind: "block", blockId });
    expect(store.getState().lastActiveTarget).toEqual({ boardId, regionId });
  });
});
