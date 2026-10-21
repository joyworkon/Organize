import { describe, expect, it } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { getMonthCells } from "./calendar-agenda";
import {
  DEFAULT_CALENDAR_VIEW_OPTIONS,
  calendarColumnCount,
  calendarViewOptionsStorageKey,
  filterCalendarTasks,
  isWeekendDay,
  loadCalendarViewOptions,
  monthCellsForView,
  parseCalendarViewOptions,
  saveCalendarViewOptions,
  visibleWeekDays,
  weekStartOf,
} from "./calendar-view-options";

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("日历显示选项：读写与解析", () => {
  it("默认值与历史行为一致（全显示、周一起始）", () => {
    expect(DEFAULT_CALENDAR_VIEW_OPTIONS).toEqual({
      showCompleted: true,
      showCountdowns: true,
      weekStart: 1,
      showWeekends: true,
    });
  });

  it("按用户读写往返；不同用户互不干扰", () => {
    const store = storage();
    const custom = { ...DEFAULT_CALENDAR_VIEW_OPTIONS, showCompleted: false, weekStart: 0 as const };
    saveCalendarViewOptions(store, "u1", custom);
    expect(loadCalendarViewOptions(store, "u1")).toEqual(custom);
    expect(loadCalendarViewOptions(store, "u2")).toEqual(DEFAULT_CALENDAR_VIEW_OPTIONS);
    expect(calendarViewOptionsStorageKey("u1")).not.toBe(calendarViewOptionsStorageKey("u2"));
  });

  it("非法 JSON / 非法字段整体作废回落默认", () => {
    expect(parseCalendarViewOptions("not json")).toBeNull();
    expect(parseCalendarViewOptions('"str"')).toBeNull();
    expect(parseCalendarViewOptions(JSON.stringify({ showCompleted: "yes" }))).toBeNull();
    expect(parseCalendarViewOptions(JSON.stringify({ weekStart: 3 }))).toBeNull();
    expect(loadCalendarViewOptions(storage({ [calendarViewOptionsStorageKey("u1")]: "xx" }), "u1")).toEqual(DEFAULT_CALENDAR_VIEW_OPTIONS);
  });

  it("缺字段回落默认值（前向兼容旧存储）", () => {
    expect(parseCalendarViewOptions(JSON.stringify({ showWeekends: false }))).toEqual({
      ...DEFAULT_CALENDAR_VIEW_OPTIONS,
      showWeekends: false,
    });
  });

  it("storage 抛异常不炸（隐私模式）", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadCalendarViewOptions(broken, "u1")).toEqual(DEFAULT_CALENDAR_VIEW_OPTIONS);
    expect(() => saveCalendarViewOptions(broken, "u1", DEFAULT_CALENDAR_VIEW_OPTIONS)).not.toThrow();
    expect(loadCalendarViewOptions(null, "u1")).toEqual(DEFAULT_CALENDAR_VIEW_OPTIONS);
  });
});

describe("周起始日与周末列计算", () => {
  it("weekStartOf：周一起始与 mondayOf 等价；周日起始返回周日", () => {
    const wednesday = new Date(2026, 9, 21); // 2026-10-21 周三
    expect(weekStartOf(wednesday, 1).getDate()).toBe(19); // 周一
    expect(weekStartOf(wednesday, 1).getDay()).toBe(1);
    expect(weekStartOf(wednesday, 0).getDate()).toBe(18); // 周日
    expect(weekStartOf(wednesday, 0).getDay()).toBe(0);
    const sunday = new Date(2026, 9, 18);
    expect(weekStartOf(sunday, 1).getDay()).toBe(1);
    expect(weekStartOf(sunday, 0).getDay()).toBe(0);
  });

  it("monthCellsForView：周日起始首格为周日；与 getMonthCells(cursor, 0) 一致", () => {
    const cursor = new Date(2026, 9, 1); // 2026-10-01 周四
    const cells = monthCellsForView(cursor, 0, true);
    expect(cells).toEqual(getMonthCells(cursor, 0));
    expect(cells[0].date.getDay()).toBe(0);
  });

  it("monthCellsForView：隐藏周末时每行 5 格工作日，行边界对齐周", () => {
    const cursor = new Date(2026, 9, 1);
    const cells = monthCellsForView(cursor, 1, false);
    expect(cells).toHaveLength(30);
    expect(cells.every((cell) => !isWeekendDay(cell.date))).toBe(true);
    // 第一行是周一到周五
    expect(cells[0].date.getDay()).toBe(1);
    expect(cells[4].date.getDay()).toBe(5);
    // 第二行仍是下一周的周一
    expect(cells[5].date.getDay()).toBe(1);
    // 本月工作日守恒：10 月 31 天 − 9 个周末日
    expect(cells.filter((cell) => cell.inMonth).length).toBe(22);
  });

  it("monthCellsForView：周日起始 + 隐藏周末时每行为周日–周四（保留前 5 列）", () => {
    const cells = monthCellsForView(new Date(2026, 9, 1), 0, false);
    expect(cells).toHaveLength(30);
    expect(cells[0].date.getDay()).toBe(0);
    expect(cells[4].date.getDay()).toBe(4); // 周四
    expect(cells[5].date.getDay()).toBe(0); // 下一行从周日开始
  });

  it("visibleWeekDays：隐藏周末保留整周前 5 天（周日起始为周日–周四）", () => {
    const week = [
      new Date(2026, 9, 18), // 周日
      new Date(2026, 9, 19),
      new Date(2026, 9, 20),
      new Date(2026, 9, 21),
      new Date(2026, 9, 22),
      new Date(2026, 9, 23), // 周五
      new Date(2026, 9, 24), // 周六
    ];
    expect(visibleWeekDays(week, true)).toHaveLength(7);
    const weekdays = visibleWeekDays(week, false);
    expect(weekdays.map((day) => day.getDay())).toEqual([0, 1, 2, 3, 4]);
  });

  it("calendarColumnCount：显示周末 7 列，隐藏 5 列", () => {
    expect(calendarColumnCount(true)).toBe(7);
    expect(calendarColumnCount(false)).toBe(5);
  });
});

describe("显示选项过滤", () => {
  const task = (id: string, status: TaskWithTags["status"]): TaskWithTags => ({
    id, user_id: "u1", title: `t-${id}`, description: null, status,
    priority: "medium", category: "work", due_date: null,
    estimated_minutes: null, actual_minutes: null, reading_item_id: null,
    note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    schedule_start_at: null,
  });

  it("隐藏已完成时滤掉 done；显示时原样返回", () => {
    const tasks = [task("t1", "todo"), task("t2", "done"), task("t3", "in_progress")];
    expect(filterCalendarTasks(tasks, { showCompleted: true })).toEqual(tasks);
    const hidden = filterCalendarTasks(tasks, { showCompleted: false });
    expect(hidden.map((item) => item.id)).toEqual(["t1", "t3"]);
  });
});
