import { describe, expect, it } from "vitest";
import { jumpTargetForDate } from "./calendar-jump-date";

describe("jumpTargetForDate：跳转选日 → 各模式 cursor/selected 落点", () => {
  it("日视图：跳到那天，cursor 对齐当月 1 日（与 step 翻页同一口径）", () => {
    expect(jumpTargetForDate("day", new Date(2026, 10, 15), 1)).toEqual({
      mode: "day",
      cursor: new Date(2026, 10, 1),
      selected: new Date(2026, 10, 15),
    });
  });

  it("周视图：cursor 对齐含该日的周起始日（周一起始把周日归入上一周）", () => {
    // 2026-11-15 是周日：周一起始的一周是 11-09（周一）~ 11-15（周日）
    expect(jumpTargetForDate("week", new Date(2026, 10, 15), 1)).toEqual({
      mode: "week",
      cursor: new Date(2026, 10, 9),
      selected: new Date(2026, 10, 15),
    });
    // 周日起始：周日即本周首日
    expect(jumpTargetForDate("week", new Date(2026, 10, 15), 0)).toEqual({
      mode: "week",
      cursor: new Date(2026, 10, 15),
      selected: new Date(2026, 10, 15),
    });
  });

  it("月视图：翻到该月并选中该日", () => {
    expect(jumpTargetForDate("month", new Date(2026, 10, 15), 1)).toEqual({
      mode: "month",
      cursor: new Date(2026, 10, 1),
      selected: new Date(2026, 10, 15),
    });
  });

  it("年视图：直接进入该日的日视图", () => {
    expect(jumpTargetForDate("year", new Date(2027, 0, 2), 1)).toEqual({
      mode: "day",
      cursor: new Date(2027, 0, 1),
      selected: new Date(2027, 0, 2),
    });
  });

  it("日程视图：以该日为 30 天窗口起点（cursor = selected = 该日）", () => {
    expect(jumpTargetForDate("agenda", new Date(2026, 9, 24), 1)).toEqual({
      mode: "agenda",
      cursor: new Date(2026, 9, 24),
      selected: new Date(2026, 9, 24),
    });
  });

  it("忽略输入时刻的时分秒", () => {
    expect(jumpTargetForDate("day", new Date(2026, 10, 15, 15, 30), 1).selected).toEqual(new Date(2026, 10, 15));
  });
});
