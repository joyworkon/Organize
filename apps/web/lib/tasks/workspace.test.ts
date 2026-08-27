import { describe, expect, it } from "vitest";
import type { TaskList, TaskWithTags } from "@organize/shared";
import { filterTasksByScope, quickAddDueDate, schedulableReminderTasks, searchTasks } from "./workspace";

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

  it("给今天范围生成当天日期", () => {
    expect(quickAddDueDate("today", now)).toBe(now.toISOString());
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
