// TaskSidebar 日期判断纯函数测试
import { describe, it, expect } from "vitest";
import { isToday, isUpcoming, isOverdue, isRootTask } from "./task-sidebar";

describe("isToday", () => {
  it("今天的日期 → true", () => {
    const now = new Date();
    expect(isToday(now.toISOString())).toBe(true);
  });
  it("明天的日期 → false", () => {
    const tomorrow = new Date(Date.now() + 86400000);
    expect(isToday(tomorrow.toISOString())).toBe(false);
  });
  it("null → false", () => {
    expect(isToday(null)).toBe(false);
  });
  it("undefined → false", () => {
    expect(isToday(undefined)).toBe(false);
  });
  it("空字符串 → false", () => {
    expect(isToday("")).toBe(false);
  });
});

describe("isUpcoming", () => {
  it("今天的日期 → true（diff=0，在 0-6 范围）", () => {
    expect(isUpcoming(new Date().toISOString())).toBe(true);
  });
  it("3 天后 → true", () => {
    const d = new Date(Date.now() + 3 * 86400000);
    expect(isUpcoming(d.toISOString())).toBe(true);
  });
  it("第 7 天 → true（自然日窗口含第 7 天全天）", () => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 12, 0, 0);
    expect(isUpcoming(d.toISOString())).toBe(true);
  });
  it("第 8 天 → false", () => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 8, 0, 0, 1);
    expect(isUpcoming(d.toISOString())).toBe(false);
  });
  it("昨天 → false", () => {
    const d = new Date(Date.now() - 2 * 86400000); // 2 天前（-1 天算今天）
    expect(isUpcoming(d.toISOString())).toBe(false);
  });
  it("null → false", () => {
    expect(isUpcoming(null)).toBe(false);
  });
});

describe("isOverdue", () => {
  it("昨天的日期 → true", () => {
    const d = new Date(Date.now() - 86400000);
    expect(isOverdue(d.toISOString())).toBe(true);
  });
  it("今天 → false（不是逾期）", () => {
    expect(isOverdue(new Date().toISOString())).toBe(false);
  });
  it("明天 → false（未来不是逾期）", () => {
    const d = new Date(Date.now() + 86400000);
    expect(isOverdue(d.toISOString())).toBe(false);
  });
  it("null → false", () => {
    expect(isOverdue(null)).toBe(false);
  });
});

describe("isRootTask", () => {
  it("仅将没有父任务的任务计入侧栏范围", () => {
    expect(isRootTask({ parent_task_id: null })).toBe(true);
    expect(isRootTask({ parent_task_id: undefined })).toBe(true);
    expect(isRootTask({ parent_task_id: "parent-task-id" })).toBe(false);
  });
});
