import { describe, expect, it } from "vitest";
import { CanvasHistory } from "./history";
import { createBoard, insertSectionAfter } from "./commands";
import { emptyDoc } from "./model";

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

describe("CanvasHistory", () => {
  it("push/undo/redo 原子恢复内容与结构", () => {
    const history = new CanvasHistory();
    const base = emptyDoc();
    const r1 = createBoard(base, { x: 0, y: 0 }, counterIds());
    history.push(base, "新建版面"); // op1 前置快照
    const r2 = insertSectionAfter(
      r1.doc,
      { boardId: r1.doc.boards[0].id, sectionId: r1.doc.boards[0].sections[0].id },
      counterIds(),
    );
    history.push(r1.doc, "新增通栏"); // op2 前置快照

    const undone = history.undo(r2.doc);
    expect(undone?.doc.boards[0].sections).toHaveLength(2); // 回到 r1
    expect(history.canRedo).toBe(true);

    const redone = history.redo(undone!.doc);
    expect(redone?.doc.boards[0].sections).toHaveLength(3); // 回到 r2
  });

  it("连续文本输入按 coalesceKey 合并为一个事务（一次 undo 回到输入前）", () => {
    const history = new CanvasHistory();
    const base = createBoard(emptyDoc(), { x: 0, y: 0 }, counterIds()).doc;
    // 三次输入，只在第一次真正入栈
    history.push(base, "输入", { coalesceKey: "text:blk1", time: 1000 });
    history.push(base, "输入", { coalesceKey: "text:blk1", time: 1500 });
    history.push(base, "输入", { coalesceKey: "text:blk1", time: 1700 });
    const undone = history.undo(base);
    expect(undone?.doc).toEqual(base);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("coalesce 窗口超时后不再合并（两个独立事务）", () => {
    const history = new CanvasHistory();
    const base = emptyDoc();
    history.push(base, "a", { coalesceKey: "k", time: 0 });
    history.push(base, "b", { coalesceKey: "k", time: 5000 });
    expect(history.undo(base)).not.toBeNull();
    expect(history.undo(base)).not.toBeNull();
    expect(history.canUndo).toBe(false);
  });

  it("新操作清空重做栈", () => {
    const history = new CanvasHistory();
    const base = emptyDoc();
    history.push(base, "a");
    history.undo(base);
    expect(history.canRedo).toBe(true);
    history.push(base, "b");
    expect(history.canRedo).toBe(false);
  });

  it("超过上限丢弃最早历史；clear 清空", () => {
    const history = new CanvasHistory(3);
    const base = emptyDoc();
    for (let i = 0; i < 5; i += 1) history.push(base, `op-${i}`, { time: i * 10000 });
    let count = 0;
    while (history.undo(base)) count += 1;
    expect(count).toBe(3);
    history.clear();
    expect(history.canUndo).toBe(false);
  });
});
