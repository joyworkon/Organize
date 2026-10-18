import { describe, expect, it } from "vitest";
import type { Task } from "@organize/shared";
import {
  TASK_HIERARCHY_LIST_LOAD_ERROR_MESSAGE,
  nextHierarchyAfterLoad,
} from "./hierarchy-list-load";

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  user_id: "u1",
  title: id,
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
  deleted_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("nextHierarchyAfterLoad", () => {
  it("on success replaces both sides and clears the error", () => {
    const plan = nextHierarchyAfterLoad({
      previousChildren: [task("old-child")],
      previousParent: task("old-parent"),
      children: { data: [task("a"), task("b")], error: null },
      parent: { data: task("new-parent"), error: null },
    });
    expect(plan.children).toEqual([task("a"), task("b")]);
    expect(plan.parent).toEqual(task("new-parent"));
    expect(plan.loadError).toBeNull();
  });

  it("on children failure keeps previousChildren while the parent side still updates", () => {
    const previousChildren = [task("old-child")];
    const plan = nextHierarchyAfterLoad({
      previousChildren,
      previousParent: task("old-parent"),
      children: { data: null, error: { message: "boom" } },
      parent: { data: task("new-parent"), error: null },
    });
    expect(plan.children).toBe(previousChildren);
    expect(plan.parent).toEqual(task("new-parent"));
    expect(plan.loadError).toBe("boom");
  });

  it("on parent failure (with error) keeps previousParent while children still update", () => {
    const previousParent = task("old-parent");
    const plan = nextHierarchyAfterLoad({
      previousChildren: [task("old-child")],
      previousParent,
      children: { data: [task("a")], error: null },
      parent: { data: null, error: { message: "parent boom" } },
    });
    expect(plan.children).toEqual([task("a")]);
    expect(plan.parent).toBe(previousParent);
    expect(plan.loadError).toBe("parent boom");
  });

  it("treats a skipped parent query (parent input null) as success with no parent", () => {
    const plan = nextHierarchyAfterLoad({
      previousChildren: [],
      previousParent: task("stale-parent"),
      children: { data: [], error: null },
      parent: null,
    });
    expect(plan.children).toEqual([]);
    expect(plan.parent).toBeNull();
    expect(plan.loadError).toBeNull();
  });

  it("treats children null data without error as a failure too, not as an empty list", () => {
    const previousChildren = [task("old-child")];
    const plan = nextHierarchyAfterLoad({
      previousChildren,
      previousParent: null,
      children: { data: null, error: null },
      parent: null,
    });
    expect(plan.children).toBe(previousChildren);
    expect(plan.loadError).toBe(TASK_HIERARCHY_LIST_LOAD_ERROR_MESSAGE);
  });

  it("falls back to the constant message when error.message is blank", () => {
    const plan = nextHierarchyAfterLoad({
      previousChildren: [],
      previousParent: null,
      children: { data: null, error: { message: "   " } },
      parent: null,
    });
    expect(plan.loadError).toBe(TASK_HIERARCHY_LIST_LOAD_ERROR_MESSAGE);
  });

  it("on first-load failure with empty snapshots reports the error instead of faking emptiness", () => {
    const plan = nextHierarchyAfterLoad({
      previousChildren: [],
      previousParent: null,
      children: { data: null, error: { message: "network down" } },
      parent: { data: null, error: { message: "network down" } },
    });
    expect(plan.children).toEqual([]);
    expect(plan.parent).toBeNull();
    expect(plan.loadError).toBe("network down");
  });

  it("maps a successful empty children array to [] with no error", () => {
    const plan = nextHierarchyAfterLoad({
      previousChildren: [task("old-child")],
      previousParent: null,
      children: { data: [], error: null },
      parent: null,
    });
    expect(plan.children).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("treats parent maybeSingle miss (null data, no error) as success with no parent", () => {
    const plan = nextHierarchyAfterLoad({
      previousChildren: [],
      previousParent: task("stale-parent"),
      children: { data: [], error: null },
      parent: { data: null, error: null },
    });
    expect(plan.parent).toBeNull();
    expect(plan.loadError).toBeNull();
  });
});
