import { describe, it, expect } from "vitest";
import { formatTimeAgo, formatDueDate, isSameDay, getDueDateColorClass } from "./date-utils";

// 固定基准时间：2026-07-31T12:00:00Z（测试不依赖 Date.now()，避免 flaky）
const NOW = new Date("2026-07-31T12:00:00Z").getTime();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// 构造一个比 NOW 早 ms 毫秒的 ISO 字符串
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("formatTimeAgo", () => {
  it("< 60s → 刚刚", () => {
    expect(formatTimeAgo(ago(30 * 1000), NOW)).toBe("刚刚");
    expect(formatTimeAgo(ago(59 * 1000), NOW)).toBe("刚刚");
  });

  it("< 1 小时 → X 分钟前（向下取整）", () => {
    expect(formatTimeAgo(ago(1 * MIN), NOW)).toBe("1 分钟前");
    expect(formatTimeAgo(ago(3 * MIN), NOW)).toBe("3 分钟前");
    expect(formatTimeAgo(ago(59 * MIN + 59 * 1000), NOW)).toBe("59 分钟前"); // 不足 60 分
  });

  it("< 24 小时 → X 小时前（向下取整）", () => {
    expect(formatTimeAgo(ago(1 * HOUR), NOW)).toBe("1 小时前");
    expect(formatTimeAgo(ago(5 * HOUR), NOW)).toBe("5 小时前");
    expect(formatTimeAgo(ago(23 * HOUR + 59 * MIN), NOW)).toBe("23 小时前"); // 不足 24
  });

  it("< 48 小时 → 昨天", () => {
    expect(formatTimeAgo(ago(24 * HOUR), NOW)).toBe("昨天");
    expect(formatTimeAgo(ago(47 * HOUR), NOW)).toBe("昨天");
  });

  it("< 7 天 → X 天前（从 2 起）", () => {
    expect(formatTimeAgo(ago(2 * DAY), NOW)).toBe("2 天前");
    expect(formatTimeAgo(ago(6 * DAY), NOW)).toBe("6 天前");
  });

  it("≥ 7 天 → M月D日", () => {
    // NOW = 2026-07-31T12:00:00Z，早 8 天 = 2026-07-23（UTC）
    expect(formatTimeAgo(ago(8 * DAY), NOW)).toBe("7月23日");
    // 早 30 天 = 2026-07-01（UTC）
    expect(formatTimeAgo(ago(30 * DAY), NOW)).toBe("7月1日");
  });

  it("非法输入 → 空字符串", () => {
    expect(formatTimeAgo("", NOW)).toBe("");
    expect(formatTimeAgo("not-a-date", NOW)).toBe("");
    expect(formatTimeAgo("2026-13-45", NOW)).toBe(""); // 无效日期
  });
});

// 回归保护：确认 date-utils 既有导出仍在（不破坏 formatTimeAgo 之外的功能）
describe("date-utils 既有导出回归", () => {
  it("formatDueDate 仍可用", () => {
    expect(typeof formatDueDate("2026-07-31")).toBe("string");
  });
  it("isSameDay 仍可用", () => {
    expect(isSameDay(new Date("2026-07-31"), new Date("2026-07-31"))).toBe(true);
  });
  it("getDueDateColorClass 仍可用", () => {
    expect(typeof getDueDateColorClass(null, "todo")).toBe("string");
  });
});
