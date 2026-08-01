// TaskMonthView 纯逻辑测试（不依赖 React DOM 渲染）
import { describe, it, expect } from "vitest";
import { getTaskDate, getMonthCells, groupTasksByDate } from "./task-month-view";
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
