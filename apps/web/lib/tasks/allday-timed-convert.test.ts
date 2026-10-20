import { describe, expect, it } from "vitest";
import {
  ALLDAY_TO_TIMED_DEFAULT_MIN,
  calendarSpanDays,
  computeTimeGridDrop,
} from "./allday-timed-convert";

const d = (day: number, hours = 0, minutes = 0) => new Date(2026, 9, day, hours, minutes);
const iso = (day: number, hours = 0, minutes = 0) => d(day, hours, minutes).toISOString();

describe("calendarSpanDays", () => {
  it("同一天与无结束都算 1 天", () => {
    expect(calendarSpanDays(d(19, 9), d(19, 10))).toBe(1);
    expect(calendarSpanDays(d(19), d(19))).toBe(1);
  });

  it("结束恰在次日 00:00 视为当天 24:00，不多算一天", () => {
    expect(calendarSpanDays(d(19, 23), d(20))).toBe(1);
    expect(calendarSpanDays(d(19), d(21))).toBe(2);
  });

  it("跨天按本地日历日差计数（含 23:59 结束与跨月）", () => {
    expect(calendarSpanDays(d(19, 22), d(21, 2))).toBe(3);
    expect(calendarSpanDays(d(19), d(21, 23, 59))).toBe(3);
    expect(calendarSpanDays(new Date(2026, 9, 31), new Date(2026, 10, 1, 12))).toBe(2);
  });

  it("结束早于开始时夹为 1 天", () => {
    expect(calendarSpanDays(d(20), d(19))).toBe(1);
  });
});

describe("computeTimeGridDrop：全天 → 定时", () => {
  it("落在吸附槽位，默认 60 分钟，all_day 翻为 false", () => {
    expect(ALLDAY_TO_TIMED_DEFAULT_MIN).toBe(60);
    expect(computeTimeGridDrop({
      start: d(19), end: d(19), allDay: true, from: "all-day", to: "timed", day: d(21), slotMin: 600,
    })).toEqual({ schedule_start_at: iso(21, 10), schedule_end_at: iso(21, 11), all_day: false });
  });

  it("不保留原全天跨度：三天全天拖进网格也只是 1 小时", () => {
    expect(computeTimeGridDrop({
      start: d(19), end: d(21, 23, 59), allDay: true, from: "all-day", to: "timed", day: d(19), slotMin: 540,
    })).toEqual({ schedule_start_at: iso(19, 9), schedule_end_at: iso(19, 10), all_day: false });
  });

  it("全天行里的跨天定时任务拖进网格同样变成 1 小时定时块", () => {
    expect(computeTimeGridDrop({
      start: d(19, 22), end: d(21, 2), allDay: false, from: "all-day", to: "timed", day: d(20), slotMin: 90,
    })).toEqual({ schedule_start_at: iso(20, 1, 30), schedule_end_at: iso(20, 2, 30), all_day: false });
  });

  it("落在 23:30 时夹到当天 24:00，不跨到次日", () => {
    expect(computeTimeGridDrop({
      start: d(19), end: d(19), allDay: true, from: "all-day", to: "timed", day: d(19), slotMin: 1410,
    })).toEqual({ schedule_start_at: iso(19, 23, 30), schedule_end_at: iso(20), all_day: false });
  });

  it("越界槽位夹在当天范围内", () => {
    expect(computeTimeGridDrop({
      start: d(19), end: d(19), allDay: true, from: "all-day", to: "timed", day: d(19), slotMin: -30,
    })).toEqual({ schedule_start_at: iso(19), schedule_end_at: iso(19, 1), all_day: false });
  });
});

describe("computeTimeGridDrop：定时 → 全天", () => {
  it("单日定时归一到落点日 00:00，end 与 start 相同，all_day 翻为 true", () => {
    expect(computeTimeGridDrop({
      start: d(19, 9), end: d(19, 10), allDay: false, from: "timed", to: "all-day", day: d(22), slotMin: 0,
    })).toEqual({ schedule_start_at: iso(22), schedule_end_at: iso(22), all_day: true });
  });

  it("结束恰在次日 00:00 的单日定时仍是单日全天", () => {
    expect(computeTimeGridDrop({
      start: d(19, 23), end: d(20), allDay: false, from: "timed", to: "all-day", day: d(20), slotMin: 0,
    })).toEqual({ schedule_start_at: iso(20), schedule_end_at: iso(20), all_day: true });
  });

  it("跨多日定时保留本地日历天数：从落点日起铺开", () => {
    expect(computeTimeGridDrop({
      start: d(19, 22), end: d(21, 2), allDay: false, from: "timed", to: "all-day", day: d(25), slotMin: 0,
    })).toEqual({ schedule_start_at: iso(25), schedule_end_at: iso(27), all_day: true });
  });

  it("忽略 slotMin", () => {
    expect(computeTimeGridDrop({
      start: d(19, 9), end: d(19, 10), allDay: false, from: "timed", to: "all-day", day: d(19), slotMin: 780,
    })).toEqual({ schedule_start_at: iso(19), schedule_end_at: iso(19), all_day: true });
  });
});

describe("computeTimeGridDrop：同区拖拽保持原有语义", () => {
  it("定时改槽位 / 改列：保持时长与 all_day=false", () => {
    expect(computeTimeGridDrop({
      start: d(19, 9), end: d(19, 10, 30), allDay: false, from: "timed", to: "timed", day: d(20), slotMin: 840,
    })).toEqual({ schedule_start_at: iso(20, 14), schedule_end_at: iso(20, 15, 30), all_day: false });
  });

  it("全天改日：保持时长与 all_day=true（含 23:59 结束的范围全天）", () => {
    expect(computeTimeGridDrop({
      start: d(19), end: d(20, 23, 59), allDay: true, from: "all-day", to: "all-day", day: d(22), slotMin: 0,
    })).toEqual({ schedule_start_at: iso(22), schedule_end_at: iso(23, 23, 59), all_day: true });
  });

  it("全天行里的跨天定时任务改日：不改 all_day，start 落到 00:00 并保持时长", () => {
    expect(computeTimeGridDrop({
      start: d(19, 22), end: d(21, 2), allDay: false, from: "all-day", to: "all-day", day: d(20), slotMin: 0,
    })).toEqual({ schedule_start_at: iso(20), schedule_end_at: iso(21, 4), all_day: false });
  });

  it("没有结束（end === start）的全天任务改日后 end 仍等于 start", () => {
    expect(computeTimeGridDrop({
      start: d(19), end: d(19), allDay: true, from: "all-day", to: "all-day", day: d(23), slotMin: 0,
    })).toEqual({ schedule_start_at: iso(23), schedule_end_at: iso(23), all_day: true });
  });

  it("结束早于开始的脏数据按零时长处理，不产生 end < start", () => {
    expect(computeTimeGridDrop({
      start: d(19, 10), end: d(19, 9), allDay: false, from: "timed", to: "timed", day: d(19), slotMin: 600,
    })).toEqual({ schedule_start_at: iso(19, 10), schedule_end_at: iso(19, 10), all_day: false });
  });
});
