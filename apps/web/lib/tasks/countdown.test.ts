import { describe, expect, it } from "vitest";
import type { CountdownDay } from "@organize/shared";
import {
  annualOccurrenceDate,
  countdownFormError,
  countdownDropDate,
  countdownDragMoved,
  rescheduleCountdownTarget,
  countdownDisplay,
  COUNTDOWN_LOAD_ERROR_MESSAGE,
  nextCountdownDaysAfterLoad,
  nextCountdownOccurrence,
  sortCountdownDays,
} from "./countdown";

const day = (target_date: string, repeat_annually = false, title = target_date): CountdownDay => ({
  id: title,
  user_id: "user",
  title,
  target_date,
  repeat_annually,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

describe("countdown date calculations", () => {
  it("shows today, future and past one-time events", () => {
    const now = new Date(2026, 7, 2, 10);
    expect(countdownDisplay(day("2026-08-02"), now)).toMatchObject({ label: "今天", days: 0 });
    expect(countdownDisplay(day("2026-08-05"), now)).toMatchObject({ label: "还有", days: 3 });
    expect(countdownDisplay(day("2026-07-30"), now)).toMatchObject({ label: "已过", days: 3 });
  });

  it("moves annual dates to the next occurrence across years", () => {
    const annual = day("2020-12-31", true);
    expect(nextCountdownOccurrence(annual, new Date(2026, 7, 2))).toBe("2026-12-31");
    expect(nextCountdownOccurrence(annual, new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(nextCountdownOccurrence(annual, new Date(2027, 0, 1))).toBe("2027-12-31");
  });

  it("clamps February 29 to February 28 in a non-leap year", () => {
    expect(annualOccurrenceDate("2024-02-29", 2025)).toBe("2025-02-28");
    expect(nextCountdownOccurrence(day("2024-02-29", true), new Date(2025, 1, 27))).toBe("2025-02-28");
    expect(nextCountdownOccurrence(day("2024-02-29", true), new Date(2025, 1, 28))).toBe("2025-02-28");
  });

  it("puts past one-time events after upcoming events", () => {
    const sorted = sortCountdownDays([
      day("2026-07-01", false, "past"),
      day("2026-08-04", false, "soon"),
      day("2026-08-03", true, "annual"),
    ], new Date(2026, 7, 2));
    expect(sorted.map((item) => item.title)).toEqual(["annual", "soon", "past"]);
  });
});

describe("nextCountdownDaysAfterLoad", () => {
  it("on success replaces the list and clears the error", () => {
    const previous = [day("2026-01-01", false, "old")];
    const fresh = [day("2026-12-31", false, "new"), day("2027-06-01", true, "annual")];
    const plan = nextCountdownDaysAfterLoad({ previous, data: fresh, error: null });
    expect(plan.days).toEqual(fresh);
    expect(plan.loadError).toBeNull();
  });

  it("on error keeps the previous snapshot and surfaces the message", () => {
    const previous = [day("2026-01-01", false, "old")];
    // Supabase/Postgrest 错误常不是 Error 实例：只要 message 可读就要用上
    const plan = nextCountdownDaysAfterLoad({ previous, data: null, error: { message: "network down" } });
    expect(plan.days).toBe(previous);
    expect(plan.loadError).toBe("network down");
  });

  it("falls back to the default message when error.message is blank", () => {
    const plan = nextCountdownDaysAfterLoad({ previous: [], data: null, error: { message: "   " } });
    expect(plan.loadError).toBe(COUNTDOWN_LOAD_ERROR_MESSAGE);
    const noMessage = nextCountdownDaysAfterLoad({ previous: [], data: null, error: {} });
    expect(noMessage.loadError).toBe(COUNTDOWN_LOAD_ERROR_MESSAGE);
  });

  it("treats nullish data without error as an empty success", () => {
    for (const data of [null, undefined]) {
      const plan = nextCountdownDaysAfterLoad({ previous: [day("2026-01-01")], data, error: null });
      expect(plan.days).toEqual([]);
      expect(plan.loadError).toBeNull();
    }
  });
});


describe("倒数日改期与共享验证", () => {
  it("一次性事件原样保留本地落点，跨年不作 ISO 转换", () => {
    expect(rescheduleCountdownTarget(day("2026-10-19"), "2027-01-01")).toBe("2027-01-01");
  });
  it.each([
    ["2020-05-01", "2028-02-29", "2020-02-29"],
    ["2021-05-01", "2028-02-29", "2021-02-28"],
    ["2020-02-29", "2027-02-28", "2020-02-28"],
    ["2020-12-31", "2027-01-01", "2020-01-01"],
  ])("年重复 %s 拖到 %s 保存 %s", (original, target, expected) => {
    expect(rescheduleCountdownTarget(day(original, true), target)).toBe(expected);
  });
  it.each(["", "2026-2-01", "2026-02-29", "2026-13-01", "2026-04-31", "0000-01-01"])("拒绝无效日期 %s", (date) => {
    expect(countdownFormError(day(date))).toBeTruthy();
    expect(() => rescheduleCountdownTarget(day("2026-01-01"), date)).toThrow();
  });
  it("标题 trim 后必填，闰日有效", () => {
    expect(countdownFormError(day("2028-02-29", false, "  "))).toBeTruthy();
    expect(countdownFormError(day("2028-02-29", false, "生日"))).toBeNull();
  });
  const cells = [0, 1, 2, 3].map((i) => ({ date: `2026-10-${19 + i}`, left: (i % 2) * 100, right: (i % 2 + 1) * 100, top: Math.floor(i / 2) * 100, bottom: (Math.floor(i / 2) + 1) * 100 }));
  it("跨周矩形落点、边缘夹紧、离开网格取消", () => {
    expect(countdownDropDate(cells, 150, 150, false)).toBe("2026-10-22");
    expect(countdownDropDate(cells, -20, 150, false)).toBe("2026-10-21");
    expect(countdownDropDate(cells, 250, 150, false)).toBe("2026-10-22");
    expect(countdownDropDate(cells, 150, 250, false)).toBeNull();
    expect(countdownDropDate(cells.slice(0, 2), 150, 250, true)).toBe("2026-10-20");
  });
  it("5px 阈值区分点击与拖拽", () => {
    expect(countdownDragMoved(10, 10, 12, 12)).toBe(false);
    expect(countdownDragMoved(10, 10, 13, 14)).toBe(true);
  });
});
