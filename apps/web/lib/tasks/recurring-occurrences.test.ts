import { describe, expect, it } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { occurrencesBetween } from "./recurrence";
import { isRecurringProjection, projectRecurringTasks, recurringSource } from "./recurring-occurrences";

const at = (year: number, month: number, day: number, hour = 9) => new Date(year, month - 1, day, hour);
const dates = (values: Date[]) => values.map((d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]);
const task: TaskWithTags = {
  id: "source", user_id: "u", title: "例会", description: null, status: "todo", priority: "medium", category: "work",
  due_date: null, estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null,
  is_pinned: false, sort_order: 0, completed_at: null, created_at: "2026-01-01", updated_at: "2026-01-01",
  schedule_start_at: at(2026, 1, 31).toISOString(), schedule_end_at: at(2026, 1, 31, 11).toISOString(),
  all_day: false, recurrence_rule: { frequency: "monthly", interval: 1 },
};

describe("occurrencesBetween", () => {
  it.each([
    ["daily", 1, [[2026, 2, 1, 9], [2026, 2, 2, 9]]],
    ["weekly", 1, [[2026, 2, 7, 9], [2026, 2, 14, 9]]],
    ["daily", 2, [[2026, 2, 2, 9], [2026, 2, 4, 9]]],
    ["weekly", 2, [[2026, 2, 14, 9], [2026, 2, 28, 9]]],
    ["monthly", 2, [[2026, 3, 31, 9], [2026, 5, 31, 9]]],
    ["yearly", 2, [[2028, 1, 31, 9], [2030, 1, 31, 9]]],
  ] as const)("%s interval %i advances without mutating source", (frequency, interval, expected) => {
    const start = at(2026, 1, 31);
    expect(dates(occurrencesBetween(start, { frequency, interval }, start, at(2035, 1, 1), 2))).toEqual(expected);
    expect(start).toEqual(at(2026, 1, 31));
  });

  it("anchors the 31st through February, March and April", () => {
    expect(dates(occurrencesBetween(at(2026, 1, 31), { frequency: "monthly", interval: 1 }, at(2026, 1, 1), at(2026, 5, 1))))
      .toEqual([[2026, 2, 28, 9], [2026, 3, 31, 9], [2026, 4, 30, 9]]);
  });
  it("clamps February in leap years", () => {
    expect(dates(occurrencesBetween(at(2028, 1, 31), { frequency: "monthly", interval: 1 }, at(2028, 2, 1), at(2028, 3, 1))))
      .toEqual([[2028, 2, 29, 9]]);
  });
  it("yearly leap-day anchor returns to February 29", () => {
    expect(dates(occurrencesBetween(at(2024, 2, 29), { frequency: "yearly", interval: 1 }, at(2025, 1, 1), at(2029, 1, 1))))
      .toEqual([[2025, 2, 28, 9], [2026, 2, 28, 9], [2027, 2, 28, 9], [2028, 2, 29, 9]]);
  });
  it("clips [from,to), excludes the real occurrence and never fills backwards", () => {
    const start = at(2026, 1, 31);
    const rule = { frequency: "daily", interval: 1 } as const;
    expect(occurrencesBetween(start, rule, at(2025, 1, 1), start)).toEqual([]);
    expect(occurrencesBetween(start, rule, start, at(2026, 2, 1))).toEqual([]);
    expect(occurrencesBetween(start, rule, at(2026, 2, 2), at(2026, 2, 3))).toEqual([at(2026, 2, 2)]);
  });
  it("skips decades before the visible range and caps emitted results", () => {
    const rule = { frequency: "daily", interval: 1 } as const;
    expect(occurrencesBetween(at(2000, 1, 1), rule, at(2050, 1, 1), at(2050, 2, 1))).toHaveLength(31);
    expect(occurrencesBetween(at(2000, 1, 1), rule, at(2050, 1, 1), at(2052, 1, 1), 999)).toHaveLength(400);
    expect(occurrencesBetween(at(2000, 1, 1), rule, at(2050, 1, 1), at(2052, 1, 1), 0)).toEqual([]);
  });
  it("rejects invalid dates/rules/ranges", () => {
    const start = at(2026, 1, 1), end = at(2026, 2, 1);
    for (const interval of [0, -1, 1.5, NaN, Infinity]) {
      expect(occurrencesBetween(start, { frequency: "daily", interval }, start, end)).toEqual([]);
    }
    expect(occurrencesBetween(new Date(NaN), { frequency: "daily", interval: 1 }, start, end)).toEqual([]);
    expect(occurrencesBetween(start, { frequency: "daily", interval: 1 }, end, start)).toEqual([]);
  });
  it("daily preserves wall-clock time across DST", () => {
    const start = at(2026, 3, 7);
    const result = occurrencesBetween(start, { frequency: "daily", interval: 1 }, start, at(2026, 3, 10));
    expect(result.map((d) => [d.getDate(), d.getHours()])).toEqual([[8, 9], [9, 9]]);
  });
});

describe("projectRecurringTasks", () => {
  const from = at(2026, 2, 1), to = at(2026, 3, 1);
  it("preserves real identity and timed duration, maps unique projections to source", () => {
    const result = projectRecurringTasks([task], from, to);
    expect(result[0]).toBe(task);
    expect(result).toHaveLength(2);
    expect(isRecurringProjection(result[1])).toBe(true);
    expect(recurringSource(result[1])).toBe(task);
    expect(result[1].id).not.toBe(task.id);
    expect(result[1].schedule_start_at).toBe(at(2026, 2, 28).toISOString());
    expect(+new Date(result[1].schedule_end_at!) - +new Date(result[1].schedule_start_at!)).toBe(2 * 3600000);
  });
  it.each([
    { status: "done" }, { status: "cancelled" }, { recurrence_rule: null },
    { deleted_at: "2026-01-01" }, { schedule_start_at: null }, { schedule_start_at: "bad" },
  ] as Partial<TaskWithTags>[])("does not project excluded task %o", (patch) => {
    expect(projectRecurringTasks([{ ...task, ...patch }], from, to)).toHaveLength(1);
  });
  it("uses due date fallback for all-day tasks without inventing an end", () => {
    const source = { ...task, all_day: true, schedule_start_at: null, schedule_end_at: null, due_date: task.schedule_start_at ?? null };
    const result = projectRecurringTasks([source], from, to);
    expect(result[1]).toMatchObject({ all_day: true, schedule_end_at: null, due_date: at(2026, 2, 28).toISOString() });
  });
  it("includes a spanning occurrence that starts before the range", () => {
    const source = { ...task, schedule_end_at: at(2026, 2, 2).toISOString() };
    const result = projectRecurringTasks([source], at(2026, 3, 1, 0), at(2026, 3, 2, 0));
    expect(result[1].schedule_start_at).toBe(at(2026, 2, 28).toISOString());
  });
});
