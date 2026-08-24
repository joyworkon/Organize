import { describe, expect, it } from "vitest";
import { applyReorderedGroup, computeSortOrderUpdates, moveIdByOffset, reorderIds } from "./reorder";

describe("reorderIds", () => {
  const ids = ["a", "b", "c", "d"];

  it("拖到目标之前", () => {
    expect(reorderIds(ids, "d", "b", false)).toEqual(["a", "d", "b", "c"]);
  });

  it("拖到目标之后", () => {
    expect(reorderIds(ids, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
  });

  it("拖到自身 / 目标不存在：不变", () => {
    expect(reorderIds(ids, "a", "a", true)).toEqual(ids);
    expect(reorderIds(ids, "a", "x", false)).toEqual(ids);
    expect(reorderIds(ids, "x", "a", false)).toEqual(ids);
  });

  it("向前移动自身紧邻位置不产生跳变", () => {
    // b 拖到 c 之后 → a c b d
    expect(reorderIds(ids, "b", "c", true)).toEqual(["a", "c", "b", "d"]);
  });
});

describe("moveIdByOffset", () => {
  const ids = ["a", "b", "c"];

  it("支持触屏菜单逐项上移或下移", () => {
    expect(moveIdByOffset(ids, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveIdByOffset(ids, "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("边界和不存在的任务保持不变", () => {
    expect(moveIdByOffset(ids, "a", -1)).toBe(ids);
    expect(moveIdByOffset(ids, "c", 1)).toBe(ids);
    expect(moveIdByOffset(ids, "x", 1)).toBe(ids);
  });
});

describe("computeSortOrderUpdates", () => {
  it("只返回 sort_order 有变化的行", () => {
    const rows = [
      { id: "a", sort_order: 0 },
      { id: "b", sort_order: 1 },
      { id: "c", sort_order: 2 },
    ];
    const updates = computeSortOrderUpdates(rows, ["c", "a", "b"]);
    expect(updates).toEqual([
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
      { id: "c", sort_order: 0 },
    ]);
  });

  it("顺序未变时返回空", () => {
    const rows = [{ id: "a", sort_order: 0 }, { id: "b", sort_order: 1 }];
    expect(computeSortOrderUpdates(rows, ["a", "b"])).toEqual([]);
  });

  it("不在新顺序里的行被跳过", () => {
    const rows = [{ id: "a", sort_order: 0 }, { id: "x", sort_order: 9 }];
    expect(computeSortOrderUpdates(rows, ["a"])).toEqual([]);
  });
});

describe("applyReorderedGroup", () => {
  const tasks = (id: string) => ({ id });

  it("组内按新顺序重排，组外任务原位不动", () => {
    const all = [tasks("g1"), tasks("other1"), tasks("g2"), tasks("other2"), tasks("g3")];
    const result = applyReorderedGroup(all, ["g3", "g1", "g2"]);
    expect(result.map((t) => t.id)).toEqual(["g3", "other1", "g1", "other2", "g2"]);
  });

  it("空组返回原数组内容", () => {
    const all = [tasks("a"), tasks("b")];
    expect(applyReorderedGroup(all, []).map((t) => t.id)).toEqual(["a", "b"]);
  });
});
