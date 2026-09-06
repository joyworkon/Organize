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

  it("K04：uuid 深链（笔记继续编辑/任务详情）放行，非法 id 拒绝", () => {
    const id = "75a190cc-74fa-4305-b927-a5211e961ba0";
    expect(isNotchOpenPathAllowed(`/notes/${id}`)).toBe(true);
    expect(isNotchOpenPathAllowed(`/tasks?task=${id}`)).toBe(true);
    // 非法 uuid / 注入形态一律拒绝
    expect(isNotchOpenPathAllowed("/notes/not-a-uuid")).toBe(false);
    expect(isNotchOpenPathAllowed(`/notes/${id}/../../settings`)).toBe(false);
    expect(isNotchOpenPathAllowed("/tasks?task=abc123")).toBe(false);
    expect(isNotchOpenPathAllowed(`/notes/${id}?x=1`)).toBe(false);
  });
});

describe("selectPanelTasks", () => {
  // 生产 startOfDay 按进程时区的本地日历判定“今天”。样本一律用本地日历显式构造，
  // 避免固定 UTC 时刻在其他时区跨日导致用例抖动；跨日语义由 UTC 跨日样本单独覆盖。
  const localMoment = (dayOffset: number, hours: number, minutes = 0): Date => {
    const date = new Date(2026, 8, 1, hours, minutes, 0, 0); // 本地 2026-09-01
    date.setDate(date.getDate() + dayOffset);
    return date;
  };
  const now = localMoment(0, 10);

  it("只留今天到期或已逾期的未完成根任务", () => {
    const tasks = [
      task({ id: "today", title: "今天", due_date: localMoment(0, 18).toISOString() }),
      task({ id: "overdue", title: "逾期", due_date: localMoment(-12, 9).toISOString() }),
      task({ id: "tomorrow", title: "明天", due_date: localMoment(1, 9).toISOString() }),
      task({ id: "nodue", title: "无日期" }),
      task({ id: "done", title: "已完成", status: "done", due_date: localMoment(0, 9).toISOString() }),
      task({ id: "child", title: "子任务", parent_task_id: "today", due_date: localMoment(0, 9).toISOString() }),
      task({ id: "deleted", title: "已删", deleted_at: localMoment(-1, 0).toISOString(), due_date: localMoment(0, 9).toISOString() }),
    ];
    const ids = selectPanelTasks(tasks, now).map((t) => t.id);
    expect(ids).toEqual(["overdue", "today"]);
  });

  it("schedule_start_at 优先于 due_date 参与判定", () => {
    const tasks = [
      task({ id: "scheduled-today", due_date: localMoment(-31, 0).toISOString(), schedule_start_at: localMoment(0, 12).toISOString() }),
    ];
    expect(selectPanelTasks(tasks, now).map((t) => t.id)).toEqual(["scheduled-today"]);
  });

  it("置顶优先、日期近的在前，最多 3 条", () => {
    const tasks = [
      task({ id: "later", title: "逾期两天", due_date: localMoment(-2, 9).toISOString() }),
      task({ id: "earlier", title: "逾期五天", due_date: localMoment(-5, 9).toISOString() }),
      task({ id: "pinned", title: "置顶今天", is_pinned: true, due_date: localMoment(0, 20).toISOString() }),
      task({ id: "fourth", title: "今天第四", due_date: localMoment(0, 21).toISOString() }),
    ];
    expect(selectPanelTasks(tasks, now).map((t) => t.id)).toEqual(["pinned", "earlier", "later"]);
  });

  it("本地晚间 23:30 的今天任务在东八区 UTC 已跨次日仍算今天（UTC 跨日样本）", () => {
    // 若实现退化成截取 UTC 字符串日期，东八区下该时刻的 UTC 日期是 09-02，会被误排除。
    const tasks = [task({ id: "late-today", due_date: localMoment(0, 23, 30).toISOString() })];
    expect(selectPanelTasks(tasks, now).map((t) => t.id)).toEqual(["late-today"]);
  });

  it("本地次日凌晨的任务不算今天，即使 UTC 日期仍是今天（UTC 跨日样本）", () => {
    // 东八区下本地 09-02 02:00 的 UTC 日期是 09-01；按 UTC 字符串判定会误收录。
    const tasks = [task({ id: "tomorrow-early", due_date: localMoment(1, 2).toISOString() })];
    expect(selectPanelTasks(tasks, now)).toEqual([]);
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
