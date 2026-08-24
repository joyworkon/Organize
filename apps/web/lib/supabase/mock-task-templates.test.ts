import { afterEach, describe, expect, it } from "vitest";
import { buildTaskFromTemplate, normalizeTaskTemplate } from "../tasks/templates";
import { createMockClient } from "./mock-client";
import { mockDb, MOCK_USER } from "./mock-data";

describe("mock task templates", () => {
  const originalTaskCount = mockDb.tasks.length;

  afterEach(() => {
    mockDb.task_templates = [];
    mockDb.tasks.splice(originalTaskCount);
  });

  it("支持模板新增、编辑、套用和删除", async () => {
    const client = createMockClient();
    const snapshot = normalizeTaskTemplate({
      title: "每周复盘",
      priority: "high",
      category: "study",
      list_id: "list-1",
    });
    const created = await client
      .from("task_templates")
      .insert({
        user_id: MOCK_USER.id,
        name: "复盘模板",
        template: snapshot,
      })
      .select("*")
      .single();

    await client
      .from("task_templates")
      .update({ name: "每周复盘模板" })
      .eq("id", created.data.id);
    expect(mockDb.task_templates[0].name).toBe("每周复盘模板");

    const task = await client
      .from("tasks")
      .insert(
        buildTaskFromTemplate(snapshot, MOCK_USER.id, {
          listId: "list-2",
          dueDate: null,
        })
      )
      .select("*")
      .single();
    expect(task.data).toMatchObject({
      title: "每周复盘",
      status: "todo",
      list_id: "list-2",
    });

    await client.from("task_templates").delete().eq("id", created.data.id);
    expect(mockDb.task_templates).toEqual([]);
  });
});
