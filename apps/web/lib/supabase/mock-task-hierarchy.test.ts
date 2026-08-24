import { afterEach, describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { mockDb, MOCK_USER } from "./mock-data";

describe("mock task hierarchy", () => {
  const originalTaskCount = mockDb.tasks.length;

  afterEach(() => {
    mockDb.tasks.splice(originalTaskCount);
  });

  it("支持按空父任务和指定父任务查询", async () => {
    const client = createMockClient();
    const parent = await client
      .from("tasks")
      .insert({
        user_id: MOCK_USER.id,
        title: "Parent",
        status: "todo",
        priority: "medium",
        category: "work",
        parent_task_id: null,
      })
      .select("*")
      .single();
    const child = await client
      .from("tasks")
      .insert({
        user_id: MOCK_USER.id,
        title: "Child",
        status: "todo",
        priority: "medium",
        category: "work",
        parent_task_id: parent.data.id,
      })
      .select("*")
      .single();

    const roots = await client.from("tasks").select("*").is("parent_task_id", null);
    const children = await client
      .from("tasks")
      .select("*")
      .eq("parent_task_id", parent.data.id);

    expect(roots.data.map((task: { id: string }) => task.id)).toContain(parent.data.id);
    expect(roots.data.map((task: { id: string }) => task.id)).not.toContain(child.data.id);
    expect(children.data.map((task: { id: string }) => task.id)).toEqual([child.data.id]);
  });
});
