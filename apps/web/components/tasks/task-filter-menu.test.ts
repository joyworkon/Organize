import { describe, expect, it } from "vitest";
import {
  EMPTY_TASK_FILTER,
  countActiveTaskFilters,
  toggleTaskFilterTag,
  type TaskFilterState,
} from "./task-filter-menu";

describe("countActiveTaskFilters", () => {
  it("默认态为 0 条生效筛选", () => {
    expect(countActiveTaskFilters(EMPTY_TASK_FILTER)).toBe(0);
  });

  it("三组单选各计 1 条", () => {
    const value: TaskFilterState = { status: "todo", category: "work", priority: "high", tagIds: [] };
    expect(countActiveTaskFilters(value)).toBe(3);
  });

  it("标签按选中个数累加（与改版前工具行计数语义一致）", () => {
    const value: TaskFilterState = { ...EMPTY_TASK_FILTER, tagIds: ["a", "b", "c"] };
    expect(countActiveTaskFilters(value)).toBe(3);
    expect(countActiveTaskFilters({ ...value, status: "done" })).toBe(4);
  });
});

describe("toggleTaskFilterTag", () => {
  it("未选中则按点击顺序追加", () => {
    const first = toggleTaskFilterTag(EMPTY_TASK_FILTER, "a");
    expect(toggleTaskFilterTag(first, "b").tagIds).toEqual(["a", "b"]);
  });

  it("已选中则移除，其余条件不变", () => {
    const value: TaskFilterState = { status: "todo", category: "all", priority: "all", tagIds: ["a", "b"] };
    const next = toggleTaskFilterTag(value, "a");
    expect(next.tagIds).toEqual(["b"]);
    expect(next.status).toBe("todo");
  });

  it("不修改传入对象（避免 setState 拿到同一引用不触发重渲染）", () => {
    const value: TaskFilterState = { ...EMPTY_TASK_FILTER, tagIds: ["a"] };
    toggleTaskFilterTag(value, "b");
    expect(value.tagIds).toEqual(["a"]);
  });
});
