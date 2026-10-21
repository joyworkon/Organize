import { describe, expect, it } from "vitest";
import {
  calendarReschedulePatch,
  nextWeekStartLabel,
  rescheduleShortcutTarget,
} from "@/lib/tasks/calendar-reschedule";

const now = (day: number, hour = 12) => new Date(2026, 9, day, hour);

describe("rescheduleShortcutTarget", () => {
  it("今天/明天返回本地日期", () => {
    expect(rescheduleShortcutTarget("today", now(21)).getDate()).toBe(21);
    expect(rescheduleShortcutTarget("tomorrow", now(21)).getDate()).toBe(22);
  });
  it("下周一：周中与周日都指向下一周的周一", () => {
    // 2026-10-21 是周三
    expect(rescheduleShortcutTarget("nextWeekStart", now(21)).getDay()).toBe(1);
    expect(rescheduleShortcutTarget("nextWeekStart", now(21)).getDate()).toBe(26);
    // 周日本身算当周最后一天，下周一是 26
    expect(rescheduleShortcutTarget("nextWeekStart", now(25)).getDate()).toBe(26);
    // 周一时「下周一」是 7 天后，不是今天
    expect(rescheduleShortcutTarget("nextWeekStart", now(19)).getDate()).toBe(26);
  });
  it("weekStart=0 时下周第一天是周日", () => {
    expect(rescheduleShortcutTarget("nextWeekStart", now(21), 0).getDay()).toBe(0);
    expect(rescheduleShortcutTarget("nextWeekStart", now(21), 0).getDate()).toBe(25);
    expect(nextWeekStartLabel(0)).toBe("下周日");
    expect(nextWeekStartLabel(1)).toBe("下周一");
  });
  it("跨月/跨年", () => {
    const from = new Date(2026, 11, 31, 9);
    expect(rescheduleShortcutTarget("tomorrow", from).getTime()).toBe(new Date(2027, 0, 1).getTime());
  });
});

describe("calendarReschedulePatch", () => {
  const timed = {
    schedule_start_at: new Date(2026, 9, 21, 9, 30).toISOString(),
    schedule_end_at: new Date(2026, 9, 21, 11, 0).toISOString(),
    due_date: new Date(2026, 9, 21, 11, 0).toISOString(),
  };
  it("定时任务移到明天：保留墙钟时刻与时长", () => {
    const patch = calendarReschedulePatch(timed, "tomorrow", now(21))!;
    expect(patch.schedule_start_at).toBe(new Date(2026, 9, 22, 9, 30).toISOString());
    expect(patch.schedule_end_at).toBe(new Date(2026, 9, 22, 11, 0).toISOString());
    expect(patch.due_date).toBe(patch.schedule_end_at);
  });
  it("跨天时段整体平移（start/end 不在同一日期）", () => {
    const crossDay = {
      schedule_start_at: new Date(2026, 9, 20, 22, 0).toISOString(),
      schedule_end_at: new Date(2026, 9, 22, 1, 30).toISOString(),
      due_date: new Date(2026, 9, 22, 1, 30).toISOString(),
    };
    const patch = calendarReschedulePatch(crossDay, "nextWeekStart", now(21))!;
    expect(patch.schedule_start_at).toBe(new Date(2026, 9, 26, 22, 0).toISOString());
    expect(patch.schedule_end_at).toBe(new Date(2026, 9, 28, 1, 30).toISOString());
  });
  it("今天：已是今天时补丁仍有效（幂等由调用方更新链路兜底）", () => {
    const patch = calendarReschedulePatch(timed, "today", now(21))!;
    expect(patch.schedule_start_at).toBe(timed.schedule_start_at);
  });
  it("全天任务保持零点与全天语义（无 end 不造 end）", () => {
    const allDay = {
      schedule_start_at: new Date(2026, 9, 21, 0, 0).toISOString(),
      schedule_end_at: null,
      due_date: new Date(2026, 9, 21, 0, 0).toISOString(),
    };
    const patch = calendarReschedulePatch(allDay, "tomorrow", now(21))!;
    expect(patch.schedule_start_at).toBe(new Date(2026, 9, 22, 0, 0).toISOString());
    expect(patch.schedule_end_at).toBeNull();
    expect(patch.due_date).toBe(patch.schedule_start_at);
  });
  it("只有 due_date 的任务以 due_date 为锚", () => {
    const dueOnly = { schedule_start_at: null, schedule_end_at: null, due_date: new Date(2026, 9, 21, 16, 0).toISOString() };
    const patch = calendarReschedulePatch(dueOnly, "tomorrow", now(21))!;
    expect(patch.schedule_start_at).toBe(new Date(2026, 9, 22, 16, 0).toISOString());
    expect(patch.schedule_end_at).toBeNull();
  });
  it("清除日期：排期与截止全部置空", () => {
    expect(calendarReschedulePatch(timed, "clear", now(21))).toEqual({
      schedule_start_at: null,
      schedule_end_at: null,
      due_date: null,
    });
  });
  it("未排期任务对日期快捷项返回 null（clear 仍可用）", () => {
    const unscheduled = { schedule_start_at: null, schedule_end_at: null, due_date: null };
    expect(calendarReschedulePatch(unscheduled, "tomorrow", now(21))).toBeNull();
    expect(calendarReschedulePatch(unscheduled, "clear", now(21))).toEqual({
      schedule_start_at: null,
      schedule_end_at: null,
      due_date: null,
    });
  });
});
