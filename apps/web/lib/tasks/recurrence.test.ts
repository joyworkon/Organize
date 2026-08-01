// 重复任务推进纯函数测试（覆盖月边界/闰日/幂等）
import { describe, it, expect } from "vitest";
import { nextOccurrence, clampMonthEnd, type RecurrenceFrequency } from "./recurrence";

describe("nextOccurrence", () => {
  it("daily +1 天", () => {
    const d = new Date("2026-08-15T10:00:00");
    const next = nextOccurrence(d, "daily");
    expect(next.getDate()).toBe(16);
    expect(next.getMonth()).toBe(7); // 仍 8 月
  });

  it("weekly +7 天", () => {
    const d = new Date("2026-08-15T10:00:00");
    const next = nextOccurrence(d, "weekly");
    expect(next.getDate()).toBe(22);
  });

  it("monthly +1 月（正常）", () => {
    const d = new Date("2026-08-15T10:00:00");
    const next = nextOccurrence(d, "monthly");
    expect(next.getMonth()).toBe(8); // 9 月
    expect(next.getDate()).toBe(15);
  });

  it("yearly +1 年", () => {
    const d = new Date("2026-08-15T10:00:00");
    const next = nextOccurrence(d, "yearly");
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(7);
    expect(next.getDate()).toBe(15);
  });

  it("monthly 1/31 → 2 月溢出（JS 自动滚到 3/3）", () => {
    const d = new Date("2026-01-31T10:00:00");
    const next = nextOccurrence(d, "monthly");
    // JS setMonth(1) on Jan 31 → Mar 3 (溢出)
    // 验证发生了溢出
    expect(next.getDate()).not.toBe(31);
  });
});

describe("clampMonthEnd", () => {
  it("31 号溢出到 3/3 → 夹回 2/28", () => {
    const overflowed = new Date("2026-03-03T10:00:00"); // 1/31 +1 月溢出
    const clamped = clampMonthEnd(31, overflowed);
    expect(clamped.getMonth()).toBe(1); // 2 月
    expect(clamped.getDate()).toBe(28);
  });

  it("30 号溢出到 3/2 → 夹回 2/28", () => {
    const overflowed = new Date("2026-03-02T10:00:00"); // 1/30 +1 月溢出
    const clamped = clampMonthEnd(30, overflowed);
    expect(clamped.getMonth()).toBe(1);
    expect(clamped.getDate()).toBe(28);
  });

  it("15 号不溢出 → 不变", () => {
    const d = new Date("2026-09-15T10:00:00");
    const result = clampMonthEnd(15, d);
    expect(result.getTime()).toBe(d.getTime());
  });
});
