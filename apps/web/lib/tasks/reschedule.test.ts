import { describe, expect, it } from "vitest";
import { computeDragReschedule } from "./reschedule";

describe("computeDragReschedule（月历拖拽改期）", () => {
  it("单日任务：只移动开始，无结束则不生成结束", () => {
    const result = computeDragReschedule({
      schedule_start_at: "2026-08-10T02:00:00.000Z",
      schedule_end_at: null,
      target: new Date("2026-08-15T02:00:00.000Z"),
    });
    expect(result.schedule_start_at).toBe("2026-08-15T02:00:00.000Z");
    expect(result.schedule_end_at).toBeNull();
  });

  it("多日范围任务：开始与结束整体平移，保留时长（不会 end < start）", () => {
    // 原 8/10 10:00 → 8/12 10:00（2 天），拖到 8/20
    const result = computeDragReschedule({
      schedule_start_at: "2026-08-10T02:00:00.000Z",
      schedule_end_at: "2026-08-12T02:00:00.000Z",
      target: new Date("2026-08-20T02:00:00.000Z"),
    });
    expect(result.schedule_start_at).toBe("2026-08-20T02:00:00.000Z");
    expect(result.schedule_end_at).toBe("2026-08-22T02:00:00.000Z");
  });

  it("带时长的单日任务：保留小时级时长", () => {
    const result = computeDragReschedule({
      schedule_start_at: "2026-08-10T09:00:00.000Z",
      schedule_end_at: "2026-08-10T11:30:00.000Z",
      target: new Date("2026-08-11T09:00:00.000Z"),
    });
    expect(result.schedule_end_at).toBe("2026-08-11T11:30:00.000Z");
  });

  it("异常数据（end < start）按无时长处理，不产生非法区间", () => {
    const result = computeDragReschedule({
      schedule_start_at: "2026-08-10T09:00:00.000Z",
      schedule_end_at: "2026-08-09T09:00:00.000Z",
      target: new Date("2026-08-15T09:00:00.000Z"),
    });
    expect(result.schedule_start_at).toBe("2026-08-15T09:00:00.000Z");
    expect(result.schedule_end_at).toBeNull();
  });

  it("原任务无开始时间：只写到目标开始", () => {
    const result = computeDragReschedule({
      schedule_start_at: null,
      schedule_end_at: "2026-08-12T02:00:00.000Z",
      target: new Date("2026-08-15T02:00:00.000Z"),
    });
    expect(result.schedule_end_at).toBeNull();
  });
});
