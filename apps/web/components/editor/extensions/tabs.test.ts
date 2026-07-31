import { describe, expect, it } from "vitest";
import { normalizeActiveIndex, normalizeTabTitle } from "./tabs";

describe("normalizeActiveIndex", () => {
  it("钳制到合法范围并对齐 tab 数量", () => {
    expect(normalizeActiveIndex(0, 3)).toBe(0);
    expect(normalizeActiveIndex(2, 3)).toBe(2);
    expect(normalizeActiveIndex(5, 3)).toBe(2); // 超出回退到最后一个
    expect(normalizeActiveIndex(-1, 3)).toBe(0); // 负数回退到 0
    expect(normalizeActiveIndex(1.5, 3)).toBe(0); // 非整数回退到 0
    expect(normalizeActiveIndex("bad", 3)).toBe(0);
  });
  it("tabCount 为 0 时回退到 0", () => {
    expect(normalizeActiveIndex(0, 0)).toBe(0);
  });
});

describe("normalizeTabTitle", () => {
  it("空值/空白回退默认标题", () => {
    expect(normalizeTabTitle("")).toBe("无标题");
    expect(normalizeTabTitle("   ")).toBe("无标题");
    expect(normalizeTabTitle(null)).toBe("无标题");
    expect(normalizeTabTitle(undefined)).toBe("无标题");
  });
  it("保留合法文本", () => {
    expect(normalizeTabTitle("概览")).toBe("概览");
    expect(normalizeTabTitle("  details  ")).toBe("details");
  });
});
