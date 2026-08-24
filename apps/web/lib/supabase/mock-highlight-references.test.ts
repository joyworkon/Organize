import { beforeEach, describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { MOCK_USER, mockDb } from "./mock-data";

const originalDb = structuredClone(mockDb);

describe("mock highlight references", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockDb)) delete mockDb[key];
    Object.assign(mockDb, structuredClone(originalDb));
    mockDb.highlights = [
      {
        id: "highlight-reference-test",
        user_id: MOCK_USER.id,
        reading_item_id: "item-1",
        content: "需要被转换的高亮文本",
        note: null,
        color: "yellow",
        note_id: null,
        task_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
  });

  it("将同一条高亮转换为相互关联的笔记和任务", async () => {
    const client = createMockClient();
    const noteResult = await client.rpc("convert_highlight_reference", {
      p_highlight_id: "highlight-reference-test",
      p_target_type: "note",
    });
    const taskResult = await client.rpc("convert_highlight_reference", {
      p_highlight_id: "highlight-reference-test",
      p_target_type: "task",
    });

    expect(noteResult.error).toBeNull();
    expect(taskResult.error).toBeNull();
    const highlight = mockDb.highlights[0];
    expect(highlight.note_id).toBe(noteResult.data.target_id);
    expect(highlight.task_id).toBe(taskResult.data.target_id);
    expect(mockDb.tasks.find((task) => task.id === highlight.task_id)?.note_id).toBe(
      highlight.note_id
    );
    expect(
      JSON.stringify(mockDb.notes.find((note) => note.id === highlight.note_id)?.content)
    ).toContain("需要被转换的高亮文本");
  });

  it("区分活跃、垃圾箱和物理缺失引用", async () => {
    const client = createMockClient();
    await client.rpc("convert_highlight_reference", {
      p_highlight_id: "highlight-reference-test",
      p_target_type: "note",
    });
    await client.rpc("convert_highlight_reference", {
      p_highlight_id: "highlight-reference-test",
      p_target_type: "task",
    });
    const highlight = mockDb.highlights[0];
    const note = mockDb.notes.find((row) => row.id === highlight.note_id);
    if (note) note.deleted_at = new Date().toISOString();
    mockDb.tasks = mockDb.tasks.filter((row) => row.id !== highlight.task_id);

    const result = await client.rpc("get_highlight_reference_states", {
      p_reading_item_id: "item-1",
    });

    expect(result.data[0]).toMatchObject({
      reading_state: "active",
      note_state: "deleted",
      task_state: "missing",
    });
  });
});
