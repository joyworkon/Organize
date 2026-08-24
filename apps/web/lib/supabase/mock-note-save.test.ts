import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { mockDb } from "./mock-data";

describe("mock save_note_with_tasks", () => {
  let originalNote: Record<string, unknown>;

  beforeEach(() => {
    originalNote = structuredClone(mockDb.notes.find((note) => note.id === "note-1"));
  });

  afterEach(() => {
    const index = mockDb.notes.findIndex((note) => note.id === "note-1");
    mockDb.notes[index] = originalNote;
    mockDb.task_item_refs = [];
  });

  it("以 revision 原子保存完整快照并递增版本", async () => {
    const client = createMockClient();
    const snapshot = {
      title: "新标题",
      content: { type: "doc", content: [] },
      icon: "N",
      cover_url: null,
      cover_position: 25,
      parent_note_id: null,
      full_width: true,
      font_family: "mono",
      small_font: true,
    };
    const result = await client.rpc("save_note_with_tasks", {
      p_note_id: "note-1",
      p_content: snapshot.content,
      p_expected_note_revision: 0,
      p_title: snapshot.title,
      p_note_snapshot: snapshot,
    });

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ status: "ok", note_revision: 1 });
    expect(mockDb.notes.find((note) => note.id === "note-1")).toMatchObject({
      ...snapshot,
      content_revision: 1,
    });
  });

  it("旧标签页使用过期 revision 时返回冲突且不覆盖新内容", async () => {
    const client = createMockClient();
    await client.rpc("save_note_with_tasks", {
      p_note_id: "note-1",
      p_content: { type: "doc", content: [] },
      p_expected_note_revision: 0,
      p_title: "标签页 A",
      p_note_snapshot: {},
    });
    const staleResult = await client.rpc("save_note_with_tasks", {
      p_note_id: "note-1",
      p_content: { type: "doc", content: [] },
      p_expected_note_revision: 0,
      p_title: "标签页 B",
      p_note_snapshot: {},
    });

    expect(staleResult.data).toEqual({
      status: "conflict_note",
      current_revision: 1,
    });
    expect(mockDb.notes.find((note) => note.id === "note-1")?.title).toBe("标签页 A");
  });
});
