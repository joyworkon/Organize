import { afterEach, describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { mockDb, MOCK_USER } from "./mock-data";

describe("mock task dependencies", () => {
  const originalTaskCount = mockDb.tasks.length;

  afterEach(() => {
    mockDb.tasks.splice(originalTaskCount);
    mockDb.task_dependencies.splice(0);
  });

  async function createTask(title: string, userId = MOCK_USER.id) {
    const result = await createMockClient()
      .from("tasks")
      .insert({
        user_id: userId,
        title,
        status: "todo",
        priority: "medium",
        category: "work",
      })
      .select("*")
      .single();
    return result.data;
  }

  it("支持新增、查询和删除依赖", async () => {
    const client = createMockClient();
    const task = await createTask("后置任务");
    const prerequisite = await createTask("前置任务");

    expect(
      await client.rpc("add_task_dependency", {
        p_task_id: task.id,
        p_depends_on_task_id: prerequisite.id,
      })
    ).toMatchObject({ data: { status: "created" }, error: null });

    const query = await client
      .from("task_dependencies")
      .select("*")
      .eq("task_id", task.id);
    expect(query.data).toHaveLength(1);

    expect(
      await client.rpc("remove_task_dependency", {
        p_task_id: task.id,
        p_depends_on_task_id: prerequisite.id,
      })
    ).toMatchObject({ data: { status: "removed" }, error: null });
    expect(mockDb.task_dependencies).toHaveLength(0);
  });

  it("拒绝自依赖、重复依赖、跨用户依赖和任意深度循环", async () => {
    const client = createMockClient();
    const taskA = await createTask("A");
    const taskB = await createTask("B");
    const taskC = await createTask("C");
    const foreignTask = await createTask(
      "外部用户",
      "00000000-0000-4000-8000-000000000999"
    );

    expect(
      (
        await client.rpc("add_task_dependency", {
          p_task_id: taskA.id,
          p_depends_on_task_id: taskA.id,
        })
      ).error.message
    ).toContain("自身");

    await client.rpc("add_task_dependency", {
      p_task_id: taskA.id,
      p_depends_on_task_id: taskB.id,
    });
    expect(
      (
        await client.rpc("add_task_dependency", {
          p_task_id: taskA.id,
          p_depends_on_task_id: taskB.id,
        })
      ).error.message
    ).toContain("已存在");

    expect(
      (
        await client.rpc("add_task_dependency", {
          p_task_id: taskA.id,
          p_depends_on_task_id: foreignTask.id,
        })
      ).error.message
    ).toContain("无权");

    await client.rpc("add_task_dependency", {
      p_task_id: taskB.id,
      p_depends_on_task_id: taskC.id,
    });
    expect(
      (
        await client.rpc("add_task_dependency", {
          p_task_id: taskC.id,
          p_depends_on_task_id: taskA.id,
        })
      ).error.message
    ).toContain("循环");
  });
});
