// TaskMonthView 纯逻辑测试（不依赖 React DOM 渲染）
import { describe, it, expect } from "vitest";
import { getTaskDate, getMonthAgenda, getMonthCells, groupTasksByDate, layoutWeekSegments, mondayOf, snapMinutes, weekDaysOf, layoutDayTimedEvents } from "./task-month-view";
import type { TaskWithTags } from "@organize/shared";

function mkTask(id: string, dateStr: string | null): TaskWithTags {
  return {
    id, user_id: "u1", title: `task-${id}`, description: null, status: "todo",
    priority: "medium", category: "work", due_date: dateStr,
    estimated_minutes: null, actual_minutes: null, reading_item_id: null,
    note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    schedule_start_at: dateStr,
  };
}

describe("getTaskDate", () => {
  it("schedule_start_at 优先", () => {
    expect(getTaskDate({ schedule_start_at: "2026-08-15T10:00:00Z", due_date: "2026-08-20T00:00:00Z" })?.getDate()).toBe(15);
  });
  it("无 schedule 时用 due_date", () => {
    // 用本地时区正午避免 UTC 边界问题
    const d = getTaskDate({ schedule_start_at: null, due_date: "2026-08-20T12:00:00Z" });
    expect(d).not.toBeNull();
    expect(d?.getMonth()).toBe(7); // 8月 (0-indexed)
  });
  it("都为 null 返回 null", () => {
    expect(getTaskDate({ schedule_start_at: null, due_date: null })).toBeNull();
  });
  it("非法日期返回 null", () => {
    expect(getTaskDate({ schedule_start_at: "not-a-date", due_date: null })).toBeNull();
  });
});

describe("getMonthCells", () => {
  it("返回 42 格（6 行 × 7 列）", () => {
    const cells = getMonthCells(new Date(2026, 7, 1)); // 2026-08
    expect(cells.length).toBe(42);
  });

  it("2026-08-01 是周六（周一开头 → 第 6 格）", () => {
    const cells = getMonthCells(new Date(2026, 7, 1));
    // cells[0] 是周一，8月1号是周六 = index 5
    expect(cells[5].date.getDate()).toBe(1);
    expect(cells[5].inMonth).toBe(true);
  });

  it("跨月格标 inMonth=false", () => {
    const cells = getMonthCells(new Date(2026, 7, 1));
    // 第一格是 7 月（上月），inMonth=false
    expect(cells[0].inMonth).toBe(false);
  });

  it("最后一格是下月", () => {
    const cells = getMonthCells(new Date(2026, 7, 1));
    // 8月31天 + offset 5 = 36 本月格，后面 6 格是 9 月
    expect(cells[41].inMonth).toBe(false);
    expect(cells[41].date.getMonth()).toBe(8); // 9月 (0-indexed)
  });

  it("2 月闰年 28 天正确", () => {
    const cells = getMonthCells(new Date(2026, 1, 1)); // 2026-02 非闰年
    const febDays = cells.filter((c) => c.inMonth).length;
    expect(febDays).toBe(28);
  });
});

describe("groupTasksByDate", () => {
  it("按日期分组", () => {
    const tasks = [
      mkTask("t1", "2026-08-15T10:00:00Z"),
      mkTask("t2", "2026-08-15T12:00:00Z"),
      mkTask("t3", "2026-08-20T00:00:00Z"),
    ];
    const grouped = groupTasksByDate(tasks);
    expect(grouped.size).toBe(2);
    const key15 = new Date("2026-08-15T10:00:00Z").toDateString();
    expect(grouped.get(key15)?.length).toBe(2);
  });

  it("无日期任务跳过", () => {
    const tasks = [mkTask("t1", null)];
    const grouped = groupTasksByDate(tasks);
    expect(grouped.size).toBe(0);
  });

  it("空数组返回空 Map", () => {
    expect(groupTasksByDate([]).size).toBe(0);
  });
});

describe("getMonthAgenda（移动端日程）", () => {
  it("只保留当前月份，并按日期和时间排序", () => {
    const tasks = [
      mkTask("late", "2026-08-15T12:00:00Z"),
      mkTask("next-month", "2026-09-01T09:00:00Z"),
      mkTask("early", "2026-08-15T08:00:00Z"),
      mkTask("first-day", "2026-08-02T08:00:00Z"),
    ];
    const groups = getMonthAgenda(tasks, new Date(2026, 7, 1));
    expect(groups).toHaveLength(2);
    expect(groups[0].date.getDate()).toBe(2);
    expect(groups[1].tasks.map((task) => task.id)).toEqual(["early", "late"]);
  });

  it("无日期或月份无任务时返回空数组", () => {
    expect(getMonthAgenda([mkTask("none", null)], new Date(2026, 7, 1))).toEqual([]);
  });
});


describe("layoutWeekSegments（跨天任务连续条布局）", () => {
  // 2026-08-17 是周一，这一周为 8/17（周一）~ 8/23（周日）
  const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 7, 17 + i));
  const L = (d: number, h = 10) => new Date(2026, 7, d, h).toISOString();

  function mkRangeTask(id: string, start: string, end: string | null): TaskWithTags {
    return {
      ...mkTask(id, start),
      schedule_end_at: end,
    } as TaskWithTags;
  }

  it("跨天任务只产生一个连续段，跨列正确", () => {
    const { segments } = layoutWeekSegments(
      [mkRangeTask("t1", L(18), L(21))],
      week
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].startCol).toBe(1); // 周二
    expect(segments[0].endCol).toBe(4);   // 周五
    expect(segments[0].continuesBefore).toBe(false);
    expect(segments[0].continuesAfter).toBe(false);
  });

  it("从上周延续 / 延续到下周：夹到周界并标记不闭合", () => {
    const { segments } = layoutWeekSegments(
      [mkRangeTask("t1", L(15), L(25))],
      week
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].startCol).toBe(0);
    expect(segments[0].endCol).toBe(6);
    expect(segments[0].continuesBefore).toBe(true);
    expect(segments[0].continuesAfter).toBe(true);
  });

  it("同一任务在相邻两周各得一段（分周渲染）", () => {
    const nextWeek = week.map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7));
    const thisWeekSegs = layoutWeekSegments([mkRangeTask("t1", L(21), L(26))], week).segments;
    const nextWeekSegs = layoutWeekSegments([mkRangeTask("t1", L(21), L(26))], nextWeek).segments;
    expect(thisWeekSegs).toHaveLength(1);
    expect(thisWeekSegs[0].continuesAfter).toBe(true);
    expect(nextWeekSegs).toHaveLength(1);
    expect(nextWeekSegs[0].continuesBefore).toBe(true);
  });

  it("不重叠的任务复用同一泳道", () => {
    const { segments } = layoutWeekSegments(
      [mkRangeTask("t1", L(17), L(18)), mkRangeTask("t2", L(19), L(20))],
      week
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].lane).toBe(0);
    expect(segments[1].lane).toBe(0);
  });

  it("重叠的任务分配到不同泳道", () => {
    const { segments } = layoutWeekSegments(
      [mkRangeTask("t1", L(17), L(20)), mkRangeTask("t2", L(18), L(21))],
      week
    );
    const lanes = segments.map((s: { lane: number }) => s.lane).sort();
    expect(lanes).toEqual([0, 1]);
  });

  it("超出 MAX_LANES 的任务折叠为每列 +N", () => {
    const tasks = [
      mkRangeTask("t1", L(18), L(18)),
      mkRangeTask("t2", L(18), L(18)),
      mkRangeTask("t3", L(18), L(18)),
      mkRangeTask("t4", L(18), L(18)),
      mkRangeTask("t5", L(18), L(18)),
    ];
    const { segments, hiddenByCol } = layoutWeekSegments(tasks, week);
    expect(segments).toHaveLength(3); // MAX_LANES = 3
    expect(hiddenByCol[1]).toBe(2);   // 周二列折叠 2 条
    expect(hiddenByCol[0]).toBe(0);
  });

  it("无日期任务与周外任务被跳过", () => {
    const { segments } = layoutWeekSegments(
      [mkTask("t1", null), mkRangeTask("t2", L(30), L(31))],
      week
    );
    expect(segments).toHaveLength(0);
  });
});

describe("snapMinutes（周视图拖拽吸附）", () => {
  it("按 30 分钟吸附并夹到非负", () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(14)).toBe(0);
    expect(snapMinutes(16)).toBe(30);
    expect(snapMinutes(50)).toBe(60);
    expect(snapMinutes(-8)).toBe(0);
  });
});

describe("weekDaysOf（周视图日期范围）", () => {
  it("周一开头，返回 7 天", () => {
    // 2026-08-28 是周五
    const days = weekDaysOf(new Date(2026, 7, 28));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1);
    expect(days[0].getDate()).toBe(24);
    expect(days[6].getDate()).toBe(30);
  });

  it("周日归入本周", () => {
    const days = weekDaysOf(new Date(2026, 7, 30));
    expect(days[0].getDate()).toBe(24);
    expect(days[6].getDate()).toBe(30);
  });

  it("mondayOf 幂等", () => {
    const monday = mondayOf(new Date(2026, 7, 24));
    expect(mondayOf(monday).getDate()).toBe(24);
  });
});

describe("layoutDayTimedEvents（周视图单日时间事件布局）", () => {
  const day = new Date(2026, 7, 26); // 周三
  const T = (id: string, sh: number, sm: number, eh: number, em: number) =>
    ({
      ...mkTask(id, new Date(2026, 7, 26, sh, sm).toISOString()),
      schedule_end_at: new Date(2026, 7, 26, eh, em).toISOString(),
    }) as TaskWithTags;

  it("重叠事件分列且上报列数", () => {
    const events = layoutDayTimedEvents([T("a", 10, 0, 11, 0), T("b", 10, 30, 11, 30)], day);
    expect(events).toHaveLength(2);
    expect(events[0].lane).toBe(0);
    expect(events[1].lane).toBe(1);
    expect(events.every((e) => e.lanes === 2)).toBe(true);
  });

  it("先后不重叠的事件复用同列", () => {
    const events = layoutDayTimedEvents([T("a", 9, 0, 10, 0), T("b", 10, 0, 11, 0)], day);
    expect(events.map((e) => e.lane)).toEqual([0, 0]);
    expect(events[0].lanes).toBe(1);
  });

  it("排除全天与跨天任务", () => {
    const allDay = {
      ...mkTask("all", new Date(2026, 7, 26, 0, 0).toISOString()),
      all_day: true,
    } as TaskWithTags;
    const cross = {
      ...mkTask("cross", new Date(2026, 7, 26, 23, 0).toISOString()),
      schedule_end_at: new Date(2026, 7, 27, 1, 0).toISOString(),
    } as TaskWithTags;
    const events = layoutDayTimedEvents([allDay, cross], day);
    expect(events).toHaveLength(0);
  });

  it("零时长任务默认占 60 分钟（避免卡片薄到不可见）", () => {
    const events = layoutDayTimedEvents([T("a", 10, 0, 10, 0)], day);
    expect(events[0].endMin - events[0].startMin).toBe(60);
  });
});
