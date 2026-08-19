import { describe, expect, it } from "vitest";
import type { TaskList, TaskWithTags } from "@organize/shared";
import { quickAddDueDate, searchTasks } from "./workspace";

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
