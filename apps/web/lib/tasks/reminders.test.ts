import { describe, expect, it } from "vitest";
import { formatOffset, reminderFireAt, reminderLabel } from "./reminders";

describe("task reminders", () => {
  it("按开始或结束时间计算触发时刻", () => {
    const task = {
      schedule_start_at: "2026-08-20T10:00:00.000Z",
      schedule_end_at: "2026-08-20T12:00:00.000Z",
      due_date: null,
    };
    expect(
      reminderFireAt(task, { anchor: "start", offset_minutes: -30 })?.toISOString()
    ).toBe("2026-08-20T09:30:00.000Z");
    expect(
      reminderFireAt(task, { anchor: "end", offset_minutes: -60 })?.toISOString()
    ).toBe("2026-08-20T11:00:00.000Z");
  });

  it("缺少结束时间时回退到开始时间", () => {
    expect(
      reminderFireAt(
        {
          schedule_start_at: "2026-08-20T10:00:00.000Z",
          schedule_end_at: null,
          due_date: null,
        },
        { anchor: "end", offset_minutes: 0 }
      )?.toISOString()
    ).toBe("2026-08-20T10:00:00.000Z");
  });

  it("格式化预设与自定义偏移", () => {
    expect(reminderLabel({ anchor: "start", offset_minutes: -10 })).toBe("开始前 10 分钟");
    expect(formatOffset(120)).toBe("后 2 小时");
  });
});
