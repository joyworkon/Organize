import { describe, expect, it } from "vitest";
import type { Task, TaskDependency } from "@organize/shared";
import {
  checkTaskCompletionBlockers,
  failedTaskDependencyLoadSections,
  getBlockedTaskIds,
  getTaskDependencyView,
  isBlockingPrerequisite,
  taskDependencyLoadErrorMessage,
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

describe("阻塞判定统一规则 isBlockingPrerequisite", () => {
  it("未完成且未删的 todo / in_progress 算阻塞", () => {
    expect(isBlockingPrerequisite({ status: "todo", deleted_at: null })).toBe(true);
    expect(
      isBlockingPrerequisite({ status: "in_progress", deleted_at: null })
    ).toBe(true);
  });

  it("已完成或已放弃不算阻塞", () => {
    expect(isBlockingPrerequisite({ status: "done", deleted_at: null })).toBe(false);
    expect(
      isBlockingPrerequisite({ status: "cancelled", deleted_at: null })
    ).toBe(false);
  });

  it("软删除（deleted_at 非空）不算阻塞，即使状态未完成", () => {
    expect(
      isBlockingPrerequisite({ status: "todo", deleted_at: "2026-10-01T00:00:00Z" })
    ).toBe(false);
  });

  it("deleted_at 缺省（字段不存在）时按未删除处理", () => {
    expect(isBlockingPrerequisite({ status: "todo" })).toBe(true);
    expect(isBlockingPrerequisite({ status: "done" })).toBe(false);
  });
});

describe("依赖面板加载失败提示纯函数", () => {
  const ok = { data: [], error: null };
  const fail = { data: null, error: { message: "boom" } };

  it("按 tasks → dependencies 顺序收集失败区块", () => {
    expect(failedTaskDependencyLoadSections({ tasks: ok, dependencies: ok })).toEqual([]);
    expect(
      failedTaskDependencyLoadSections({ tasks: ok, dependencies: fail })
    ).toEqual(["依赖关系"]);
    expect(
      failedTaskDependencyLoadSections({ tasks: fail, dependencies: ok })
    ).toEqual(["任务列表"]);
    expect(
      failedTaskDependencyLoadSections({ tasks: fail, dependencies: fail })
    ).toEqual(["任务列表", "依赖关系"]);
  });

  it("生成错误条文案：单项点名影响，双项合并成一句，空列表返回 null", () => {
    expect(taskDependencyLoadErrorMessage([])).toBeNull();
    expect(taskDependencyLoadErrorMessage(["任务列表"])).toBe(
      "任务列表加载失败，依赖关系可能不完整"
    );
    expect(taskDependencyLoadErrorMessage(["依赖关系"])).toBe(
      "依赖关系加载失败，显示的内容可能不完整"
    );
    expect(taskDependencyLoadErrorMessage(["任务列表", "依赖关系"])).toBe(
      "任务列表与依赖关系加载失败，显示的内容可能不完整"
    );
  });
});

describe("标记完成前的依赖检查 checkTaskCompletionBlockers", () => {
  type QueryResult = { data: unknown; error: unknown };

  function fakeSupabase({
    dependencies,
    tasks,
    onTasksQuery,
  }: {
    dependencies: QueryResult;
    tasks?: QueryResult;
    onTasksQuery?: (ids: string[]) => void;
  }) {
    return {
      from(table: string) {
        if (table === "task_dependencies") {
          return {
            select: () => ({
              eq: () => Promise.resolve(dependencies),
            }),
          };
        }
        return {
          select: () => ({
            in: (_column: string, ids: string[]) => {
              onTasksQuery?.(ids);
              return Promise.resolve(tasks ?? { data: null, error: null });
            },
          }),
        };
      },
    } as unknown as Parameters<typeof checkTaskCompletionBlockers>[0];
  }

  it("依赖关系查询失败时返回 error，不发前置任务查询", async () => {
    const queried: string[][] = [];
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: { data: null, error: { message: "boom" } },
        onTasksQuery: (ids) => queried.push(ids),
      }),
      "a"
    );
    expect(result).toEqual({ status: "error" });
    expect(queried).toEqual([]);
  });

  it("前置任务查询失败时返回 error", async () => {
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: { data: [{ depends_on_task_id: "b" }], error: null },
        tasks: { data: null, error: { message: "boom" } },
      }),
      "a"
    );
    expect(result).toEqual({ status: "error" });
  });

  it("没有依赖时返回 ok + 空列表，且不发前置任务查询", async () => {
    for (const data of [[], null]) {
      const queried: string[][] = [];
      const result = await checkTaskCompletionBlockers(
        fakeSupabase({
          dependencies: { data, error: null },
          onTasksQuery: (ids) => queried.push(ids),
        }),
        "a"
      );
      expect(result).toEqual({ status: "ok", blocking: [] });
      expect(queried).toEqual([]);
    }
  });

  it("只返回未完成的前置任务", async () => {
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: {
          data: [{ depends_on_task_id: "b" }, { depends_on_task_id: "c" }],
          error: null,
        },
        tasks: {
          data: [
            { id: "b", title: "B", status: "done" },
            { id: "c", title: "C", status: "todo" },
          ],
          error: null,
        },
      }),
      "a"
    );
    expect(result).toEqual({
      status: "ok",
      blocking: [{ id: "c", title: "C" }],
    });
  });

  it("前置任务全部完成时返回 ok + 空列表", async () => {
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: { data: [{ depends_on_task_id: "b" }], error: null },
        tasks: { data: [{ id: "b", title: "B", status: "done" }], error: null },
      }),
      "a"
    );
    expect(result).toEqual({ status: "ok", blocking: [] });
  });

  it("前置已放弃（cancelled）时不阻塞，与依赖面板一致", async () => {
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: { data: [{ depends_on_task_id: "b" }], error: null },
        tasks: {
          data: [{ id: "b", title: "B", status: "cancelled", deleted_at: null }],
          error: null,
        },
      }),
      "a"
    );
    expect(result).toEqual({ status: "ok", blocking: [] });
  });

  it("前置已软删除（deleted_at 非空）时不阻塞，与依赖面板一致", async () => {
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: { data: [{ depends_on_task_id: "b" }], error: null },
        tasks: {
          data: [
            {
              id: "b",
              title: "B",
              status: "todo",
              deleted_at: "2026-10-01T00:00:00Z",
            },
          ],
          error: null,
        },
      }),
      "a"
    );
    expect(result).toEqual({ status: "ok", blocking: [] });
  });

  it("前置未完成且未删（todo / in_progress）时阻塞并返回 id/title", async () => {
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: {
          data: [{ depends_on_task_id: "b" }, { depends_on_task_id: "c" }],
          error: null,
        },
        tasks: {
          data: [
            { id: "b", title: "B", status: "in_progress", deleted_at: null },
            { id: "c", title: "C", status: "todo", deleted_at: null },
          ],
          error: null,
        },
      }),
      "a"
    );
    expect(result).toEqual({
      status: "ok",
      blocking: [
        { id: "b", title: "B" },
        { id: "c", title: "C" },
      ],
    });
  });

  it("depIds 有 2 个但只查回 1 个时返回 error，不静默放行", async () => {
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: {
          data: [{ depends_on_task_id: "b" }, { depends_on_task_id: "c" }],
          error: null,
        },
        tasks: {
          data: [{ id: "b", title: "B", status: "done", deleted_at: null }],
          error: null,
        },
      }),
      "a"
    );
    expect(result).toEqual({ status: "error" });
  });

  it("depIds 有重复 id、查回该 1 行时不误判为 error", async () => {
    const queried: string[][] = [];
    const result = await checkTaskCompletionBlockers(
      fakeSupabase({
        dependencies: {
          data: [
            { depends_on_task_id: "b" },
            { depends_on_task_id: "b" },
          ],
          error: null,
        },
        tasks: {
          data: [{ id: "b", title: "B", status: "done", deleted_at: null }],
          error: null,
        },
        onTasksQuery: (ids) => queried.push(ids),
      }),
      "a"
    );
    expect(result).toEqual({ status: "ok", blocking: [] });
    // 去重后只按唯一 id 查询与核对
    expect(queried).toEqual([["b"]]);
  });
});
