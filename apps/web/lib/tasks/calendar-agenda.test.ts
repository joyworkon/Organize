import { describe, expect, it } from "vitest";
import type { CountdownDay, TaskWithTags } from "@organize/shared";
import { isRecurringProjection, projectRecurringTasks } from "./recurring-occurrences";
import {
  agendaScrollTargetKey,
  buildMonthAgenda,
  calendarAddDate,
  monthSelectionOnEntry,
  calendarDayKey,
  calendarDayMarkers,
  compactMonthRows,
  emptyMonthAddDate,
  getMonthCells,
  withSelectedAgendaDay,
} from "./calendar-agenda";

function mkTask(id: string, start: string | null, end: string | null = null, extra: Partial<TaskWithTags> = {}): TaskWithTags {
  return {
    id, user_id: "u1", title: `task-${id}`, description: null, status: "todo",
    priority: "medium", category: "work", due_date: start,
    estimated_minutes: null, actual_minutes: null, reading_item_id: null,
    note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    schedule_start_at: start, schedule_end_at: end, ...extra,
  };
}
const L = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m, d, h, min).toISOString();
const countdown = (id: string, target_date: string): CountdownDay => ({
  id, user_id: "u1", title: id, target_date, repeat_annually: false,
  deleted_at: null, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
});
const byDay = (...items: Array<[Date, CountdownDay[]]>) => new Map(items.map(([date, list]) => [calendarDayKey(date), list]));

const AUG = new Date(2026, 7, 1);

describe("buildMonthAgenda", () => {
  it("只保留当前月份，并按日期和时间排序（原 getMonthAgenda 合同）", () => {
    const tasks = [
      mkTask("late", L(2026, 7, 15, 12)),
      mkTask("next-month", L(2026, 8, 1, 9)),
      mkTask("early", L(2026, 7, 15, 8)),
      mkTask("first-day", L(2026, 7, 2, 8)),
    ];
    const days = buildMonthAgenda(tasks, new Map(), AUG);
    expect(days.map((day) => day.date.getDate())).toEqual([2, 15]);
    expect(days[1].entries.map((entry) => entry.task.id)).toEqual(["early", "late"]);
    expect(days[1].entries.every((entry) => entry.spanIndex === 0 && entry.spanDays === 1)).toBe(true);
  });

  it("无日期或本月无任务时返回空数组", () => {
    expect(buildMonthAgenda([mkTask("none", null)], new Map(), AUG)).toEqual([]);
    expect(buildMonthAgenda([mkTask("sep", L(2026, 8, 3))], new Map(), AUG)).toEqual([]);
  });

  it("跨天任务在覆盖的每一天都出现，带第几天 / 总天数", () => {
    const days = buildMonthAgenda([mkTask("span", L(2026, 7, 18), L(2026, 7, 20))], new Map(), AUG);
    expect(days.map((day) => day.date.getDate())).toEqual([18, 19, 20]);
    expect(days.map((day) => day.entries[0])).toMatchObject([
      { spanIndex: 0, spanDays: 3 },
      { spanIndex: 1, spanDays: 3 },
      { spanIndex: 2, spanDays: 3 },
    ]);
  });

  it("从上月延续进来、延续到下月的任务只保留本月天数，天序号按任务真实起点算", () => {
    const tasks = [
      mkTask("from-july", L(2026, 6, 30), L(2026, 7, 2)),
      mkTask("into-sep", L(2026, 7, 30), L(2026, 8, 2)),
    ];
    const days = buildMonthAgenda(tasks, new Map(), AUG);
    expect(days.map((day) => day.date.getDate())).toEqual([1, 2, 30, 31]);
    expect(days[0].entries[0]).toMatchObject({ spanIndex: 2, spanDays: 4 });
    expect(days[1].entries[0]).toMatchObject({ spanIndex: 3, spanDays: 4 });
    expect(days[2].entries[0]).toMatchObject({ spanIndex: 0, spanDays: 4 });
    expect(days[3].entries[0]).toMatchObject({ spanIndex: 1, spanDays: 4 });
  });

  it("结束在次日零点的任务仍盖住次日；结束早于开始的脏数据按单日处理", () => {
    const tasks = [
      mkTask("midnight", L(2026, 7, 18, 22), new Date(2026, 7, 19, 0, 0).toISOString()),
      mkTask("inverted", L(2026, 7, 25, 10), L(2026, 7, 24, 10)),
    ];
    const days = buildMonthAgenda(tasks, new Map(), AUG);
    expect(days.map((day) => day.date.getDate())).toEqual([18, 19, 25]);
    expect(days[1].entries[0]).toMatchObject({ task: { id: "midnight" }, spanIndex: 1, spanDays: 2 });
    expect(days[2].entries[0]).toMatchObject({ task: { id: "inverted" }, spanIndex: 0, spanDays: 1 });
  });

  it("延续中的任务排在当天新开始的任务之前（开始更早）", () => {
    const tasks = [
      mkTask("new-early", L(2026, 7, 19, 8)),
      mkTask("continuing", L(2026, 7, 18, 9), L(2026, 7, 19, 18)),
    ];
    const [, aug19] = buildMonthAgenda(tasks, new Map(), AUG);
    expect(aug19.date.getDate()).toBe(19);
    expect(aug19.entries.map((entry) => entry.task.id)).toEqual(["continuing", "new-early"]);
  });

  it("仅倒数日的日期并入列表并按日期统一排序；其他月份的倒数日忽略", () => {
    const tasks = [mkTask("a", L(2026, 7, 15)), mkTask("b", L(2026, 7, 20))];
    const countdowns = byDay(
      [new Date(2026, 7, 10), [countdown("c10", "2026-08-10")]],
      [new Date(2026, 7, 20), [countdown("c20", "2026-08-20")]],
      [new Date(2026, 8, 5), [countdown("c-sep", "2026-09-05")]],
      [new Date(2026, 7, 28), []],
    );
    const days = buildMonthAgenda(tasks, countdowns, AUG);
    expect(days.map((day) => day.date.getDate())).toEqual([10, 15, 20]);
    expect(days[0].entries).toEqual([]);
    expect(days[0].countdowns.map((item) => item.id)).toEqual(["c10"]);
    expect(days[2].entries.map((entry) => entry.task.id)).toEqual(["b"]);
    expect(days[2].countdowns.map((item) => item.id)).toEqual(["c20"]);
  });

  it("重复任务的只读投影按发生日期出现，保留投影标记", () => {
    const weekly = mkTask("weekly", L(2026, 7, 3, 9), L(2026, 7, 3, 10), { recurrence_rule: { frequency: "weekly", interval: 1 } });
    const cells = getMonthCells(AUG);
    const projected = projectRecurringTasks([weekly], cells[0].date, new Date(2026, 8, 7));
    const days = buildMonthAgenda(projected, new Map(), AUG);
    expect(days.map((day) => day.date.getDate())).toEqual([3, 10, 17, 24, 31]);
    expect(isRecurringProjection(days[0].entries[0].task)).toBe(false);
    expect(days.slice(1).every((day) => isRecurringProjection(day.entries[0].task))).toBe(true);
  });

  it("不改输入数组顺序", () => {
    const tasks = [mkTask("b", L(2026, 7, 2, 12)), mkTask("a", L(2026, 7, 2, 8))];
    buildMonthAgenda(tasks, new Map(), AUG);
    expect(tasks.map((task) => task.id)).toEqual(["b", "a"]);
  });
});

describe("withSelectedAgendaDay", () => {
  const agenda = buildMonthAgenda([mkTask("a", L(2026, 7, 5)), mkTask("b", L(2026, 7, 20))], new Map(), AUG);

  it("选中空日按时间顺序插入空分组", () => {
    expect(withSelectedAgendaDay(agenda, new Date(2026, 7, 12), AUG).map((day) => day.date.getDate())).toEqual([5, 12, 20]);
    expect(withSelectedAgendaDay(agenda, new Date(2026, 7, 1), AUG).map((day) => day.date.getDate())).toEqual([1, 5, 20]);
    expect(withSelectedAgendaDay(agenda, new Date(2026, 7, 31, 23), AUG).map((day) => day.date.getDate())).toEqual([5, 20, 31]);
    const inserted = withSelectedAgendaDay(agenda, new Date(2026, 7, 12), AUG)[1];
    expect(inserted).toEqual({ key: "2026-7-12", date: new Date(2026, 7, 12), entries: [], countdowns: [] });
  });

  it("选中日已有分组、不在本月或为空时原样返回", () => {
    expect(withSelectedAgendaDay(agenda, new Date(2026, 7, 20), AUG)).toBe(agenda);
    expect(withSelectedAgendaDay(agenda, new Date(2026, 8, 20), AUG)).toBe(agenda);
    expect(withSelectedAgendaDay(agenda, null, AUG)).toBe(agenda);
  });
});

describe("agendaScrollTargetKey", () => {
  const agenda = buildMonthAgenda([mkTask("a", L(2026, 7, 5)), mkTask("b", L(2026, 7, 20))], new Map(), AUG);

  it("今天有安排滚到今天，否则今天之后最近一天，之后没有则 null", () => {
    expect(agendaScrollTargetKey(agenda, new Date(2026, 7, 5, 15), AUG)).toBe("2026-7-5");
    expect(agendaScrollTargetKey(agenda, new Date(2026, 7, 6), AUG)).toBe("2026-7-20");
    expect(agendaScrollTargetKey(agenda, new Date(2026, 7, 21), AUG)).toBeNull();
  });

  it("不是当前月时返回 null", () => {
    expect(agendaScrollTargetKey(agenda, new Date(2026, 8, 1), AUG)).toBeNull();
  });
});

describe("calendarDayMarkers", () => {
  it("统计盖住当天的任务（含跨天首尾、重复投影）与当天倒数日", () => {
    const weekly = mkTask("weekly", L(2026, 7, 17, 9), L(2026, 7, 17, 10), { recurrence_rule: { frequency: "weekly", interval: 1 } });
    const tasks = projectRecurringTasks([
      mkTask("span", L(2026, 7, 18), L(2026, 7, 20)),
      mkTask("single", L(2026, 7, 19, 15)),
      mkTask("none", null),
      weekly,
    ], new Date(2026, 7, 17), new Date(2026, 7, 31));
    const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 7, 17 + i));
    const markers = calendarDayMarkers(tasks, byDay([new Date(2026, 7, 21), [countdown("c", "2026-08-21")]]), days);
    const summary = days.map((day) => {
      const marker = markers.get(calendarDayKey(day))!;
      return `${day.getDate()}:${marker.tasks}/${marker.countdowns}`;
    });
    expect(summary).toEqual(["17:1/0", "18:1/0", "19:2/0", "20:1/0", "21:0/1", "22:0/0", "23:0/0"]);
    expect(calendarDayMarkers(tasks, new Map(), [new Date(2026, 7, 24)]).get("2026-7-24")).toEqual({ tasks: 1, countdowns: 0 });
  });
});

describe("compactMonthRows", () => {
  it("裁掉整行非本月的尾行，保留补位前导行", () => {
    expect(compactMonthRows(getMonthCells(new Date(2026, 9, 1)))).toHaveLength(5);
    expect(compactMonthRows(getMonthCells(new Date(2027, 1, 1)))).toHaveLength(4);
    const august = compactMonthRows(getMonthCells(AUG));
    expect(august).toHaveLength(6);
    expect(august[0].slice(0, 5).every((cell) => !cell.inMonth)).toBe(true);
    expect(august[5][0].date).toEqual(new Date(2026, 7, 31));
    expect(august.every((row) => row.length === 7)).toBe(true);
  });
});

describe("emptyMonthAddDate", () => {
  it("选中日在本月优先，其次今天，否则 1 日", () => {
    expect(emptyMonthAddDate(AUG, new Date(2026, 7, 9, 12), new Date(2026, 7, 25, 8))).toEqual(new Date(2026, 7, 25));
    expect(emptyMonthAddDate(AUG, new Date(2026, 7, 9, 12), new Date(2026, 6, 25))).toEqual(new Date(2026, 7, 9));
    expect(emptyMonthAddDate(AUG, new Date(2026, 8, 9), null)).toEqual(new Date(2026, 7, 1));
  });
});


describe("日历选中与添加目标", () => {
  const today = new Date(2026, 9, 21, 12);
  it("月份入口：当前月回今天，其余月钳制日号，兼容跨年与闰年", () => {
    expect(monthSelectionOnEntry(new Date(2026, 9, 1), today, new Date(2026, 8, 30))).toEqual(new Date(2026, 9, 21));
    expect(monthSelectionOnEntry(new Date(2026, 10, 1), today, new Date(2026, 9, 31))).toEqual(new Date(2026, 10, 30));
    expect(monthSelectionOnEntry(new Date(2027, 1, 1), today, new Date(2027, 0, 31))).toEqual(new Date(2027, 1, 28));
    expect(monthSelectionOnEntry(new Date(2028, 1, 1), today, new Date(2028, 0, 31))).toEqual(new Date(2028, 1, 29));
    expect(monthSelectionOnEntry(new Date(2027, 0, 1), today, new Date(2026, 11, 31))).toEqual(new Date(2027, 0, 31));
    expect(monthSelectionOnEntry(new Date(2027, 0, 1), today, null)).toEqual(new Date(2027, 0, 1));
  });
  it("月添加：本月选中日 > 今天 > 月初，过期选中日不会漏到旧月", () => {
    const month = new Date(2026, 9, 1);
    expect(calendarAddDate("month", month, today, new Date(2026, 9, 25, 15), [])).toEqual(new Date(2026, 9, 25));
    expect(calendarAddDate("month", month, today, null, [])).toEqual(new Date(2026, 9, 21));
    expect(calendarAddDate("month", new Date(2026, 10, 1), today, today, [])).toEqual(new Date(2026, 10, 1));
  });
  it("周添加：可见选中日 > 可见今天 > 可见周首日，日添加保持当天", () => {
    const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 19 + i));
    expect(calendarAddDate("week", days[0], today, days[6], days)).toEqual(days[6]);
    expect(calendarAddDate("week", days[0], today, new Date(2026, 8, 1), days)).toEqual(new Date(2026, 9, 21));
    expect(calendarAddDate("week", days[0], new Date(2026, 10, 1), null, days)).toEqual(days[0]);
    expect(calendarAddDate("day", days[0], today, days[6], days)).toEqual(days[6]);
  });
});
