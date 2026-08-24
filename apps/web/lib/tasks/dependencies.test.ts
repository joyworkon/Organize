import { describe, expect, it } from "vitest";
import type { Task, TaskDependency } from "@organize/shared";
import {
  getBlockedTaskIds,
  getTaskDependencyView,
  wouldCreateTaskDependencyCycle,
} from "./dependencies";

const tasks = [
  { id: "a", title: "A", status: "todo" },
  { id: "b", title: "B", status: "done" },
  { id: "c", title: "C", status: "in_progress" },
] as Task[];
const edges = [
  { task_id: "a", depends_on_task_id: "b" },
  { task_id: "a", depends_on_task_id: "c" },
  { task_id: "c", depends_on_task_id: "b" },
] as TaskDependency[];

describe("task dependency helpers", () => {
  it("同时解析前置、后置和未完成阻塞项", () => {
    const view = getTaskDependencyView(tasks, edges, "a");
    expect(view.prerequisites.map((task) => task.id)).toEqual(["b", "c"]);
    expect(view.blockingPrerequisites.map((task) => task.id)).toEqual(["c"]);
    expect(getTaskDependencyView(tasks, edges, "b").dependents.map((task) => task.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("仅以前置任务是否完成派生阻塞状态", () => {
    expect(Array.from(getBlockedTaskIds(tasks, edges))).toEqual(["a"]);
  });

  it("检测新增边导致的直接和任意深度循环", () => {
    expect(wouldCreateTaskDependencyCycle(edges, "a", "a")).toBe(true);
    expect(wouldCreateTaskDependencyCycle(edges, "b", "a")).toBe(true);
    expect(wouldCreateTaskDependencyCycle(edges, "c", "a")).toBe(true);
    expect(wouldCreateTaskDependencyCycle(edges, "a", "b")).toBe(false);
  });
});
