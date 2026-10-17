import { describe, expect, it } from "vitest";
import type { CountdownDay } from "@organize/shared";
import {
  annualOccurrenceDate,
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
