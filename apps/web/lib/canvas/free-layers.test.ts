import { describe, expect, it } from "vitest";
import { reorderFreeZIndexes, type FreeZItem } from "./free-layers";

function items(...pairs: [string, number][]): FreeZItem[] {
  return pairs.map(([id, zIndex]) => ({ id, zIndex }));
}

function orderOf(source: readonly FreeZItem[], patches: { itemId: string; zIndex: number }[]): string[] {
  const zOf = new Map(source.map((item) => [item.id, item.zIndex]));
  for (const patch of patches) zOf.set(patch.itemId, patch.zIndex);
  return [...source].sort((a, b) => (zOf.get(a.id) ?? 0) - (zOf.get(b.id) ?? 0) || source.indexOf(a) - source.indexOf(b)).map((item) => item.id);
}

describe("reorderFreeZIndexes", () => {
  const stack = items(["a", 1], ["b", 2], ["c", 4]);

  it("置于顶层让选中项连续位于未选项之上，并保持选中项的相对顺序", () => {
    const patches = reorderFreeZIndexes(stack, ["a", "c"], "front");
    expect(orderOf(stack, patches)).toEqual(["b", "a", "c"]);
    expect(patches.every((patch) => Number.isInteger(patch.zIndex) && patch.zIndex >= 1 && patch.zIndex <= 10000)).toBe(true);
    const z = new Map(patches.map((patch) => [patch.itemId, patch.zIndex]));
    expect((z.get("a") ?? 1)).toBeLessThan(z.get("c") ?? 0);
    expect(z.get("c")).toBeGreaterThan(z.get("b") ?? 2);
  });

  it("置于底层落到最低，组内顺序不变", () => {
    const patches = reorderFreeZIndexes(stack, ["b"], "back");
    expect(orderOf(stack, patches)).toEqual(["b", "a", "c"]);
  });

  it("已在顶层再置于顶层不改 zIndex", () => {
    const source = items(["a", 2], ["b", 10]);
    expect(reorderFreeZIndexes(source, ["b"], "front")).toEqual([]);
    expect(reorderFreeZIndexes(source, ["a", "b"], "front")).toEqual([]);
    expect(reorderFreeZIndexes(source, ["a"], "back")).toEqual([]);
  });

  it("上移一层与紧邻未选项交换；连续选中作为一组跨过那一个邻居", () => {
    expect(orderOf(stack, reorderFreeZIndexes(stack, ["a"], "forward"))).toEqual(["b", "a", "c"]);
    expect(orderOf(stack, reorderFreeZIndexes(stack, ["a", "b"], "forward"))).toEqual(["c", "a", "b"]);
    expect(reorderFreeZIndexes(stack, ["c"], "forward")).toEqual([]);
  });

  it("下移一层与下面的未选项交换；已经在底层则不动", () => {
    expect(orderOf(stack, reorderFreeZIndexes(stack, ["c"], "backward"))).toEqual(["a", "c", "b"]);
    expect(orderOf(stack, reorderFreeZIndexes(stack, ["b", "c"], "backward"))).toEqual(["b", "c", "a"]);
    expect(reorderFreeZIndexes(stack, ["a"], "backward")).toEqual([]);
  });

  it("不相邻的多选各自相对未选项移动一层，选中项不互相穿过", () => {
    const split = items(["s1", 1], ["u1", 2], ["s2", 3], ["u2", 4]);
    expect(orderOf(split, reorderFreeZIndexes(split, ["s1", "s2"], "forward"))).toEqual(["u1", "s1", "u2", "s2"]);
    expect(orderOf(split, reorderFreeZIndexes(split, ["s1", "s2"], "backward"))).toEqual(["s1", "s2", "u1", "u2"]);
  });

  it("相同 zIndex 时数组中更早的在下", () => {
    const tied = items(["a", 1], ["b", 1]);
    const patches = reorderFreeZIndexes(tied, ["a"], "forward");
    expect(orderOf(tied, patches)).toEqual(["b", "a"]);
    expect(patches).toEqual([{ itemId: "a", zIndex: 2 }]);
  });

  it("空选、未知 id、只有一个元素时返回空", () => {
    expect(reorderFreeZIndexes(stack, [], "front")).toEqual([]);
    expect(reorderFreeZIndexes(stack, ["missing"], "back")).toEqual([]);
    expect(reorderFreeZIndexes([], ["a"], "forward")).toEqual([]);
    expect(reorderFreeZIndexes(items(["only", 4]), ["only"], "front")).toEqual([]);
    expect(reorderFreeZIndexes(items(["only", 4]), ["only"], "backward")).toEqual([]);
  });
});
