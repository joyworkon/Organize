import { describe, expect, it } from "vitest";
import { formatTaskDate } from "./task-date-popover";

/**
 * T03 回归：日期展示统一中文短格式（替代 M/D/YY），
 * 同年省略年份，非零点补时间，全天/零点不显示冗余时间。
 */
describe("formatTaskDate（T03 中文短日期）", () => {
  it("空值显示设置引导", () => {
    expect(formatTaskDate(null)).toBe("设置日期");
    expect(formatTaskDate(undefined)).toBe("设置日期");
    expect(formatTaskDate("bad-date")).toBe("设置日期");
  });

  it("同年日期：M月D日，零点/全天不带时间", () => {
    const thisYear = new Date().getFullYear();
    expect(formatTaskDate(`${thisYear}-09-06T00:00:00`)).toBe("9月6日");
    expect(formatTaskDate(`${thisYear}-12-31T00:00`)).toBe("12月31日");
  });

  it("跨年日期：带年份", () => {
    expect(formatTaskDate("2025-09-06T00:00:00")).toBe("2025年9月6日");
  });

  it("带时刻：补 HH:mm", () => {
    const thisYear = new Date().getFullYear();
    expect(formatTaskDate(`${thisYear}-09-06T14:30:00`)).toBe("9月6日 14:30");
    expect(formatTaskDate(`${thisYear}-01-02T09:05:00`)).toBe("1月2日 09:05");
  });
});
