import { describe, expect, it } from "vitest";
import {
  MIN_COLUMN_WIDTH,
  normalizeColumnCount,
  normalizeColumnWidths,
  resizeColumnWidths,
} from "./columns";

describe("columns width model", () => {
  it("只允许 2 到 5 列", () => {
    expect(normalizeColumnCount(1)).toBe(2);
    expect(normalizeColumnCount(3)).toBe(3);
    expect(normalizeColumnCount(8)).toBe(5);
    expect(normalizeColumnCount("bad")).toBe(2);
  });

  it("旧笔记没有宽度数据时生成等宽列", () => {
    expect(normalizeColumnWidths(null, 2)).toEqual([50, 50]);
    expect(normalizeColumnWidths(undefined, 5)).toEqual([20, 20, 20, 20, 20]);
  });

  it("宽度归一化后总和为 100，且没有列低于最小宽度", () => {
    const widths = normalizeColumnWidths([1, 1, 98], 3);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(100);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
  });

  it("拖动分隔条只改变相邻两列并保持总宽", () => {
    const widths = resizeColumnWidths([25, 25, 25, 25], 4, 1, 8);
    expect(widths).toEqual([25, 33, 17, 25]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(100);
  });

  it("拖动到极限时两侧仍保留最小可编辑宽度", () => {
    expect(resizeColumnWidths([50, 50], 2, 0, 100)).toEqual([90, 10]);
    expect(resizeColumnWidths([50, 50], 2, 0, -100)).toEqual([10, 90]);
  });
});
