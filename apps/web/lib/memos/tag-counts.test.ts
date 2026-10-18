import { describe, expect, it } from "vitest";

import { countMemoTagsLocally, MEMO_TAG_COUNTS_FALLBACK_HINT } from "./tag-counts";

describe("countMemoTagsLocally", () => {
  it("空数组返回空结果", () => {
    expect(countMemoTagsLocally([])).toEqual([]);
  });

  it("跨速记累计同一标签并按数量降序", () => {
    const memos = [
      { tags: ["a", "b"] },
      { tags: ["b"] },
      { tags: ["b", "c"] },
      { tags: ["c"] },
      { tags: ["d"] },
      { tags: ["d"] },
    ];
    // b=3；c=2、d=2 同数按名称升序；a=1
    expect(countMemoTagsLocally(memos)).toEqual([
      ["b", 3],
      ["c", 2],
      ["d", 2],
      ["a", 1],
    ]);
  });

  it("同数标签按名称 localeCompare 升序（与 /api/memos/tags 排序一致）", () => {
    const memos = [
      { tags: ["beta"] },
      { tags: ["alpha", "beta"] },
      { tags: ["alpha"] },
      { tags: ["gamma"] },
    ];
    expect(countMemoTagsLocally(memos)).toEqual([
      ["alpha", 2],
      ["beta", 2],
      ["gamma", 1],
    ]);
  });

  it("中文标签正常计数并按数量降序", () => {
    const memos = [
      { tags: ["工作"] },
      { tags: ["工作", "读书"] },
      { tags: ["工作"] },
    ];
    expect(countMemoTagsLocally(memos)).toEqual([
      ["工作", 3],
      ["读书", 1],
    ]);
  });

  it("tags 为 null / undefined 的条目被跳过", () => {
    const memos = [{ tags: null }, {}, { tags: ["x"] }, { tags: [] }];
    expect(countMemoTagsLocally(memos)).toEqual([["x", 1]]);
  });

  it("降级提示常量为非空中文文案", () => {
    expect(MEMO_TAG_COUNTS_FALLBACK_HINT.length).toBeGreaterThan(0);
  });
});
