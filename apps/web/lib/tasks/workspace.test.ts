import { describe, expect, it } from "vitest";
import type { TaskList, TaskWithTags } from "@organize/shared";
import { filterTasksByScope, isTaskOverdue, isWithinNextSevenDays, quickAddDueDate, schedulableReminderTasks, searchTasks } from "./workspace";

const task = (overrides: Partial<TaskWithTags>): TaskWithTags => ({
  id: "task-1",
  user_id: "user-1",
  title: "默认任务",
  description: "默认描述",
  status: "todo",
  priority: "medium",
  category: "work",
  due_date: null,
  estimated_minutes: null,
  actual_minutes: null,
  reading_item_id: null,
  note_id: null,
  is_pinned: false,
  sort_order: 0,
  completed_at: null,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  tags: [],
  ...overrides,
});

const lists = [{
  id: "list-work",
  user_id: "user-1",
  name: "工作清单",
  icon: null,
  color: null,
  sort_order: 0,
  is_default: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}] satisfies TaskList[];

describe("task search", () => {
  it("matches title, description, list and tags case-insensitively", () => {
    const tasks = [
      task({ id: "title", title: "Ship API" }),
      task({ id: "description", title: "普通标题", description: "Review API contract" }),
      task({ id: "list", title: "普通标题", list_id: "list-work" }),
      task({ id: "tag", title: "普通标题", tags: [{ id: "tag", user_id: "user-1", name: "Backend" }] }),
    ];
    for (const query of ["ship", "CONTRACT", "工作清单", "backend"]) {
      expect(searchTasks(tasks, query, lists)).toHaveLength(1);
    }
  });

  it("includes completed/cancelled tasks but excludes trash", () => {
    const tasks = [
      task({ id: "done", title: "Done result", status: "done" }),
      task({ id: "cancelled", title: "Cancelled result", status: "cancelled" }),
      task({ id: "trash", title: "Done result in trash", status: "done", deleted_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(searchTasks(tasks, "result", lists).map((item) => item.id)).toEqual(["done", "cancelled"]);
  });

  it("returns no results for blank queries（搜索页语义：输入关键词才开始搜索）", () => {
    const tasks = [task({ id: "active" }), task({ id: "trash", deleted_at: "2026-01-02T00:00:00Z" })];
    expect(searchTasks(tasks, "  ", lists)).toEqual([]);
  });
});

describe("quickAddDueDate", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");

  it("给今天范围生成当天 23:59:59，而不是创建瞬间（否则任务一落库就过期）", () => {
    const due = new Date(quickAddDueDate("today", now)!);
    // 用本地分量断言：存储值是本地当天的 23:59:59，与运行时区无关
    expect(due.getFullYear()).toBe(now.getFullYear());
    expect(due.getMonth()).toBe(now.getMonth());
    expect(due.getDate()).toBe(now.getDate());
    expect(due.getHours()).toBe(23);
    expect(due.getMinutes()).toBe(59);
    expect(due.getSeconds()).toBe(59);
    expect(due.getTime()).toBeGreaterThan(now.getTime());
  });

  it("给最近7天范围生成明天上午的日期，避免请求完成时落到过去", () => {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    expect(quickAddDueDate("upcoming", now)).toBe(tomorrow.toISOString());
  });

  it("普通清单范围保持无日期", () => {
    expect(quickAddDueDate("all", now)).toBeNull();
    expect(quickAddDueDate("list", now)).toBeNull();
  });
});

describe("filterTasksByScope", () => {
  it("所有范围只展示根任务，子任务由父任务详情承载", () => {
    const tasks = [
      task({ id: "root", parent_task_id: null }),
      task({ id: "child", parent_task_id: "root" }),
      task({
        id: "deleted-root",
        parent_task_id: null,
        deleted_at: "2026-01-02T00:00:00Z",
      }),
      task({
        id: "deleted-child",
        parent_task_id: "root",
        deleted_at: "2026-01-02T00:00:00Z",
      }),
    ];

    expect(filterTasksByScope(tasks, { scope: "all", listId: null }).map((item) => item.id))
      .toEqual(["root"]);
    expect(filterTasksByScope(tasks, { scope: "trash", listId: null }).map((item) => item.id))
      .toEqual(["deleted-root"]);
  });
});

describe("schedulableReminderTasks（提醒只吃可见集）", () => {

  it("已软删的任务被剔除", () => {
    const deleted = task({ id: "deleted", title: "d", deleted_at: "2026-08-01T00:00:00Z" });
    const alive = task({ id: "alive", title: "a" });
    expect(schedulableReminderTasks([deleted, alive]).map((t) => t.id)).toEqual(["alive"]);
  });

  it("父任务软删后的幽灵子任务一并剔除", () => {
    const parent = task({ id: "p1", title: "p", deleted_at: "2026-08-01T00:00:00Z" });
    const child = task({ id: "c1", title: "c", parent_task_id: "p1" });
    const grandchild = task({ id: "g1", title: "g", parent_task_id: "c1" });
    const unrelated = task({ id: "u1", title: "u", parent_task_id: null });
    expect(schedulableReminderTasks([parent, child, grandchild, unrelated]).map((t) => t.id))
      .toEqual(["u1"]);
  });

  it("未删除的父任务下所有子任务保留", () => {
    const parent = task({ id: "p2", title: "p" });
    const child = task({ id: "c2", title: "c", parent_task_id: "p2" });
    expect(schedulableReminderTasks([parent, child]).length).toBe(2);
  });
});

describe("isWithinNextSevenDays（自然日窗口）", () => {
  const now = new Date(2026, 7, 19, 15, 0, 0); // 2026-08-19 15:00 本地

  it("今天早些时候截止的任务仍然算在最近7天内", () => {
    const thisMorning = new Date(2026, 7, 19, 9, 0, 0).toISOString();
    expect(isWithinNextSevenDays(thisMorning, now)).toBe(true);
  });

  it("昨天及以前不算", () => {
    const yesterday = new Date(2026, 7, 18, 12, 0, 0).toISOString();
    expect(isWithinNextSevenDays(yesterday, now)).toBe(false);
  });

  it("第 7 天全天含当日结束，第 8 天排除", () => {
    const day7 = new Date(2026, 7, 26, 23, 59, 59).toISOString();
    const day8 = new Date(2026, 7, 27, 0, 0, 0).toISOString();
    expect(isWithinNextSevenDays(day7, now)).toBe(true);
    expect(isWithinNextSevenDays(day8, now)).toBe(false);
  });

  it("空值与非法值安全", () => {
    expect(isWithinNextSevenDays(null, now)).toBe(false);
    expect(isWithinNextSevenDays("bad-date", now)).toBe(false);
  });
});

/** T03 回归：逾期只看「截止」语义，进行中跨天任务不因开始日已过而判逾期 */
describe("isTaskOverdue（T03 日期语义）", () => {
  const now = new Date(2026, 8, 6, 12, 0, 0, 0); // 2026-09-06 12:00 本地时间

  const base = { status: "todo", all_day: false } as const;

  it("带时刻截止：时刻已过即逾期（含今天稍早已截止）", () => {
    expect(isTaskOverdue(task({ ...base, due_date: "2026-09-06T09:00:00" }), now)).toBe(true);
    expect(isTaskOverdue(task({ ...base, due_date: "2026-09-05T18:00:00" }), now)).toBe(true);
  });

  it("未来截止与今天尚未到达的时刻不是逾期", () => {
    expect(isTaskOverdue(task({ ...base, due_date: "2026-09-06T18:00:00" }), now)).toBe(false);
    expect(isTaskOverdue(task({ ...base, due_date: "2026-09-07T09:00:00" }), now)).toBe(false);
  });

  it("全天截止：当天结束前不算逾期", () => {
    expect(isTaskOverdue(task({ ...base, all_day: true, due_date: "2026-09-06T00:00:00" }), now)).toBe(false);
    expect(isTaskOverdue(task({ ...base, all_day: true, due_date: "2026-09-05T00:00:00" }), now)).toBe(true);
  });

  it("已完成/已取消不显示逾期", () => {
    expect(isTaskOverdue(task({ ...base, status: "done", due_date: "2026-09-01T09:00:00" }), now)).toBe(false);
    expect(isTaskOverdue(task({ ...base, status: "cancelled", due_date: "2026-09-01T09:00:00" }), now)).toBe(false);
  });

  it("跨天进行中任务：只有开始时间已过、无截止 → 不逾期", () => {
    expect(isTaskOverdue(task({ ...base, due_date: null }), now)).toBe(false);
  });

  it("空值/非法值安全", () => {
    expect(isTaskOverdue(task({ ...base, due_date: null }), now)).toBe(false);
    expect(isTaskOverdue(task({ ...base, due_date: "bad-date" }), now)).toBe(false);
  });
});
