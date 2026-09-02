import { describe, expect, it } from "vitest";
import type { Memo, Task } from "@organize/shared";
import {
  insertMemoOptimistic,
  isNotchOpenPathAllowed,
  memoTimeLabel,
  notchRoleFromLabel,
  selectPanelTasks,
} from "./notch";

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    user_id: "u1",
    title: partial.title ?? "任务",
    description: null,
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
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Task;
}

function memo(id: string, createdAt: string): Memo {
  return {
    id,
    user_id: "u1",
    content: `内容 ${id}`,
    tags: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

describe("notchRoleFromLabel", () => {
  it("按 Tauri 窗口 label 映射角色，其余为演示态", () => {
    expect(notchRoleFromLabel("notch-trigger-0")).toBe("trigger");
    expect(notchRoleFromLabel("notch-trigger-1")).toBe("trigger");
    expect(notchRoleFromLabel("notch-trigger")).toBe("demo");
    expect(notchRoleFromLabel("notch-panel")).toBe("panel");
    expect(notchRoleFromLabel("main")).toBe("demo");
    expect(notchRoleFromLabel(null)).toBe("demo");
    expect(notchRoleFromLabel(undefined)).toBe("demo");
  });
});

describe("isNotchOpenPathAllowed", () => {
  it("只放行快速入口白名单与 /login", () => {
    for (const path of ["/memos", "/library", "/notes", "/tasks", "/settings", "/login"]) {
      expect(isNotchOpenPathAllowed(path)).toBe(true);
    }
    expect(isNotchOpenPathAllowed("/inbox")).toBe(false);
    expect(isNotchOpenPathAllowed("https://evil.example")).toBe(false);
    expect(isNotchOpenPathAllowed("//evil.example")).toBe(false);
    expect(isNotchOpenPathAllowed(42)).toBe(false);
    expect(isNotchOpenPathAllowed(null)).toBe(false);
  });
});

describe("selectPanelTasks", () => {
  const now = new Date("2026-09-01T10:00:00");

  it("只留今天到期或已逾期的未完成根任务", () => {
    const tasks = [
      task({ id: "today", title: "今天", due_date: "2026-09-01T18:00:00.000Z" }),
      task({ id: "overdue", title: "逾期", due_date: "2026-08-20T09:00:00.000Z" }),
      task({ id: "tomorrow", title: "明天", due_date: "2026-09-02T09:00:00.000Z" }),
      task({ id: "nodue", title: "无日期" }),
      task({ id: "done", title: "已完成", status: "done", due_date: "2026-09-01T09:00:00.000Z" }),
      task({ id: "child", title: "子任务", parent_task_id: "today", due_date: "2026-09-01T09:00:00.000Z" }),
      task({ id: "deleted", title: "已删", deleted_at: "2026-08-31T00:00:00.000Z", due_date: "2026-09-01T09:00:00.000Z" }),
    ];
    const ids = selectPanelTasks(tasks, now).map((t) => t.id);
    expect(ids).toEqual(["overdue", "today"]);
  });

  it("schedule_start_at 优先于 due_date 参与判定", () => {
    const tasks = [
      task({ id: "scheduled-today", due_date: "2026-08-01T00:00:00.000Z", schedule_start_at: "2026-09-01T12:00:00.000Z" }),
    ];
    expect(selectPanelTasks(tasks, now).map((t) => t.id)).toEqual(["scheduled-today"]);
  });

  it("置顶优先、日期近的在前，最多 3 条", () => {
    const tasks = [
      task({ id: "later", title: "逾期两天", due_date: "2026-08-30T09:00:00.000Z" }),
      task({ id: "earlier", title: "逾期五天", due_date: "2026-08-27T09:00:00.000Z" }),
      task({ id: "pinned", title: "置顶今天", is_pinned: true, due_date: "2026-09-01T20:00:00.000Z" }),
      task({ id: "fourth", title: "今天第四", due_date: "2026-09-01T21:00:00.000Z" }),
    ];
    expect(selectPanelTasks(tasks, now).map((t) => t.id)).toEqual(["pinned", "earlier", "later"]);
  });
});

describe("insertMemoOptimistic", () => {
  it("新速记插到顶部并截断到 3 条", () => {
    const list = [memo("a", "2026-09-01T08:00:00.000Z"), memo("b", "2026-08-31T08:00:00.000Z"), memo("c", "2026-08-30T08:00:00.000Z")];
    const next = insertMemoOptimistic(list, memo("new", "2026-09-01T10:00:00.000Z"));
    expect(next.map((m) => m.id)).toEqual(["new", "a", "b"]);
  });

  it("按 id 去重（保存后重新拉取不会重复）", () => {
    const list = [memo("a", "2026-09-01T08:00:00.000Z")];
    const next = insertMemoOptimistic(list, memo("a", "2026-09-01T08:00:00.000Z"));
    expect(next.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("memoTimeLabel", () => {
  it("今天显示 HH:mm，更早显示 M月d日", () => {
    const now = new Date("2026-09-01T10:00:00");
    expect(memoTimeLabel("2026-09-01T09:05:00", now)).toBe("09:05");
    expect(memoTimeLabel("2026-08-31T09:05:00", now)).toBe("8月31日");
    expect(memoTimeLabel("not-a-date", now)).toBe("");
  });
});
