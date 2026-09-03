import { describe, expect, it } from "vitest";
import {
  DUE_SOON_WINDOW_MINUTES,
  buildDueSoonFilter,
  toDueSoonTasks,
} from "./due-soon";

describe("buildDueSoonFilter", () => {
  it("两锚点各落在 [from,to] 窗口的 or 过滤串", () => {
    const from = new Date("2026-09-03T08:00:00.000Z");
    const to = new Date("2026-09-03T08:15:00.000Z");
    expect(buildDueSoonFilter(from, to)).toBe(
      [
        "and(schedule_start_at.gte.2026-09-03T08:00:00.000Z,schedule_start_at.lte.2026-09-03T08:15:00.000Z)",
        "and(schedule_end_at.gte.2026-09-03T08:00:00.000Z,schedule_end_at.lte.2026-09-03T08:15:00.000Z)",
      ].join(",")
    );
  });

  it("窗口常量为 15 分钟", () => {
    expect(DUE_SOON_WINDOW_MINUTES).toBe(15);
  });
});

describe("toDueSoonTasks", () => {
  const from = new Date("2026-09-03T08:00:00.000Z");
  const to = new Date("2026-09-03T08:15:00.000Z");

  it("start/end 双锚点都命中时产出两行", () => {
    const rows = [
      {
        id: "task-1",
        title: "评审",
        schedule_start_at: "2026-09-03T08:05:00.000Z",
        schedule_end_at: "2026-09-03T08:10:00.000Z",
      },
    ];
    expect(toDueSoonTasks(rows, from, to)).toEqual([
      { task_id: "task-1", title: "评审", anchor: "start" },
      { task_id: "task-1", title: "评审", anchor: "end" },
    ]);
  });

  it("窗口外的锚点不产出", () => {
    const rows = [
      {
        id: "task-1",
        title: "已过期",
        schedule_start_at: "2026-09-03T07:59:00.000Z",
        schedule_end_at: null,
      },
      {
        id: "task-2",
        title: "窗口外",
        schedule_start_at: "2026-09-03T08:16:00.000Z",
        schedule_end_at: null,
      },
    ];
    expect(toDueSoonTasks(rows, from, to)).toEqual([]);
  });

  it("缺 id/title 或时间非法的行静默丢弃", () => {
    const rows = [
      { id: "", title: "无 id", schedule_start_at: "2026-09-03T08:05:00.000Z" },
      { id: "task-2", title: "", schedule_start_at: "2026-09-03T08:05:00.000Z" },
      { id: "task-3", title: "时间非法", schedule_start_at: "not-a-date" },
      {
        id: 123,
        title: "id 非字符串",
        schedule_start_at: "2026-09-03T08:05:00.000Z",
      },
    ];
    expect(toDueSoonTasks(rows, from, to)).toEqual([]);
  });

  it("只保留 task_id/title/anchor 三字段", () => {
    const rows = [
      {
        id: "task-9",
        title: "瘦身",
        user_id: "someone",
        status: "todo",
        schedule_start_at: "2026-09-03T08:05:00.000Z",
        schedule_end_at: null,
      },
    ];
    const out = toDueSoonTasks(rows, from, to);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(["anchor", "task_id", "title"]);
  });
});
