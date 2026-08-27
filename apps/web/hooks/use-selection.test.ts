import { describe, expect, it } from "vitest";
import { pruneSelection } from "./use-selection";

describe("pruneSelection（多选幽灵项裁剪）", () => {
  it("筛选变化后裁掉不可见的选择项", () => {
    const next = pruneSelection(new Set(["a", "b", "c"]), ["b", "c", "d"]);
    expect(Array.from(next!).sort()).toEqual(["b", "c"]);
  });

  it("可见集包含全部选择时返回 null（调用方复用原引用避免重渲染）", () => {
    expect(pruneSelection(new Set(["a", "b"]), ["a", "b", "c"])).toBeNull();
  });

  it("全部不可见时清空选择集", () => {
    const next = pruneSelection(new Set(["a"]), [] as string[]);
    expect(next!.size).toBe(0);
  });
});
