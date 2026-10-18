import { describe, expect, it } from "vitest";
import {
  READING_STATS_LOAD_ERROR_MESSAGE,
  countReadingStats,
  nextReadingStatsAfterLoad,
} from "./stats-load";

describe("countReadingStats", () => {
  it("counts an empty result as all zeros", () => {
    expect(countReadingStats([])).toEqual({ total: 0, unread: 0, reading: 0, read: 0 });
  });

  it("counts each known status correctly", () => {
    const stats = countReadingStats([
      { reading_status: "unread" },
      { reading_status: "unread" },
      { reading_status: "reading" },
      { reading_status: "read" },
      { reading_status: "read" },
      { reading_status: "read" },
    ]);
    expect(stats).toEqual({ total: 6, unread: 2, reading: 1, read: 3 });
  });

  it("counts unknown or null statuses into total only", () => {
    const stats = countReadingStats([
      { reading_status: null },
      { reading_status: "archived" },
      {},
    ]);
    expect(stats).toEqual({ total: 3, unread: 0, reading: 0, read: 0 });
  });
});

describe("nextReadingStatsAfterLoad", () => {
  it("on success recounts and clears the error", () => {
    const plan = nextReadingStatsAfterLoad({
      previous: { total: 9, unread: 9, reading: 0, read: 0 },
      data: [{ reading_status: "unread" }, { reading_status: "read" }],
      error: null,
    });
    expect(plan.stats).toEqual({ total: 2, unread: 1, reading: 0, read: 1 });
    expect(plan.statsError).toBeNull();
  });

  it("on failure keeps the previous stats by reference and surfaces the error message", () => {
    const previous = { total: 9, unread: 9, reading: 0, read: 0 };
    const plan = nextReadingStatsAfterLoad({
      previous,
      data: null,
      error: { message: "Failed to fetch" },
    });
    expect(plan.stats).toBe(previous);
    expect(plan.statsError).toBe("Failed to fetch");
  });

  it("on failure with no previous success returns null stats instead of fake zeros", () => {
    const plan = nextReadingStatsAfterLoad({ previous: null, data: null, error: {} });
    expect(plan.stats).toBeNull();
    expect(plan.statsError).toBe(READING_STATS_LOAD_ERROR_MESSAGE);
  });

  it("falls back to the standard message when error.message is blank", () => {
    const previous = { total: 1, unread: 0, reading: 1, read: 0 };
    const plan = nextReadingStatsAfterLoad({
      previous,
      data: null,
      error: { message: "   " },
    });
    expect(plan.stats).toBe(previous);
    expect(plan.statsError).toBe(READING_STATS_LOAD_ERROR_MESSAGE);
  });

  it("treats null data without an error as a failure, not as an empty count", () => {
    const plan = nextReadingStatsAfterLoad({ previous: null, data: null, error: null });
    expect(plan.stats).toBeNull();
    expect(plan.statsError).toBe(READING_STATS_LOAD_ERROR_MESSAGE);
  });
});
