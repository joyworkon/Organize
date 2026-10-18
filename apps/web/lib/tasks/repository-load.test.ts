import { describe, expect, it } from "vitest";
import type { TaskList, TaskWithTags } from "@organize/shared";
import {
  TASK_REPOSITORY_LOAD_ERROR_MESSAGE,
  nextTaskRepositoryAfterLoad,
} from "./repository-load";

const task = (id: string): TaskWithTags => ({
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
});

const list = (id: string): TaskList => ({
  id,
  user_id: "u1",
  name: id,
  icon: null,
  color: null,
  sort_order: 0,
  is_default: false,
  deleted_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

describe("nextTaskRepositoryAfterLoad", () => {
  it("replaces both sides and clears the error after a successful load", () => {
    const nextTasks = [task("new-task")];
    const nextLists = [list("new-list")];
    const plan = nextTaskRepositoryAfterLoad({
      previousTasks: [task("old-task")],
      previousLists: [list("old-list")],
      tasks: { data: nextTasks, error: null },
      lists: { data: nextLists, error: null },
    });

    expect(plan.tasks).toBe(nextTasks);
    expect(plan.lists).toBe(nextLists);
    expect(plan.loadError).toBeNull();
  });

  it("keeps both previous snapshots by reference when tasks fail", () => {
    const previousTasks = [task("old-task")];
    const previousLists = [list("old-list")];
    const plan = nextTaskRepositoryAfterLoad({
      previousTasks,
      previousLists,
      tasks: { data: null, error: { message: "tasks boom" } },
      lists: { data: [list("new-list")], error: null },
    });

    expect(plan.tasks).toBe(previousTasks);
    expect(plan.lists).toBe(previousLists);
    expect(plan.loadError).toBe("tasks boom");
  });

  it("keeps both previous snapshots by reference when lists fail", () => {
    const previousTasks = [task("old-task")];
    const previousLists = [list("old-list")];
    const plan = nextTaskRepositoryAfterLoad({
      previousTasks,
      previousLists,
      tasks: { data: [task("new-task")], error: null },
      lists: { data: null, error: { message: "lists boom" } },
    });

    expect(plan.tasks).toBe(previousTasks);
    expect(plan.lists).toBe(previousLists);
    expect(plan.loadError).toBe("lists boom");
  });

  it("accepts successful empty arrays instead of reporting an error", () => {
    const nextTasks: TaskWithTags[] = [];
    const nextLists: TaskList[] = [];
    const plan = nextTaskRepositoryAfterLoad({
      previousTasks: [task("old-task")],
      previousLists: [list("old-list")],
      tasks: { data: nextTasks, error: null },
      lists: { data: nextLists, error: null },
    });

    expect(plan.tasks).toBe(nextTasks);
    expect(plan.lists).toBe(nextLists);
    expect(plan.loadError).toBeNull();
  });

  it("treats null data without an error as a failure with the default message", () => {
    const previousTasks = [task("old-task")];
    const previousLists = [list("old-list")];
    const plan = nextTaskRepositoryAfterLoad({
      previousTasks,
      previousLists,
      tasks: { data: null, error: null },
      lists: { data: [], error: null },
    });

    expect(plan.tasks).toBe(previousTasks);
    expect(plan.lists).toBe(previousLists);
    expect(plan.loadError).toBe(TASK_REPOSITORY_LOAD_ERROR_MESSAGE);
  });

  it("falls back to the default message when error messages are blank", () => {
    const plan = nextTaskRepositoryAfterLoad({
      previousTasks: [],
      previousLists: [],
      tasks: { data: null, error: { message: "   " } },
      lists: { data: null, error: {} },
    });

    expect(plan.loadError).toBe(TASK_REPOSITORY_LOAD_ERROR_MESSAGE);
  });

  it("uses the lists error message when tasks have null data without an error", () => {
    const plan = nextTaskRepositoryAfterLoad({
      previousTasks: [],
      previousLists: [],
      tasks: { data: null, error: null },
      lists: { data: null, error: { message: "lists unavailable" } },
    });

    expect(plan.loadError).toBe("lists unavailable");
  });
});
