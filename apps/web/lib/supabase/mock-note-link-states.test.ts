import { beforeEach, describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";
import { MOCK_USER, mockDb } from "./mock-data";

const originalDb = structuredClone(mockDb);

describe("mock note content link states", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockDb)) delete mockDb[key];
    Object.assign(mockDb, structuredClone(originalDb));
  });

  it("批量区分当前用户的活跃、删除和缺失链接", async () => {
    const deletedNote = {
      ...mockDb.notes[0],
      id: "deleted-note",
      deleted_at: new Date().toISOString(),
    };
    mockDb.notes.push(deletedNote);

    const result = await createMockClient().rpc("get_note_content_link_states", {
      p_note_ids: [mockDb.notes[0].id, deletedNote.id, "missing-note"],
      p_reading_item_ids: [mockDb.reading_items[0].id, "missing-reading"],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource_type: "note", resource_id: deletedNote.id, state: "deleted" }),
        expect.objectContaining({ resource_type: "note", resource_id: "missing-note", state: "missing" }),
        expect.objectContaining({ resource_type: "reading", resource_id: mockDb.reading_items[0].id, state: "active" }),
        expect.objectContaining({ resource_type: "reading", resource_id: "missing-reading", state: "missing" }),
      ])
    );
  });

  it("不泄漏其他用户同 id 资源", async () => {
    mockDb.notes.push({
      ...mockDb.notes[0],
      id: "foreign-note",
      user_id: `${MOCK_USER.id}-other`,
    });

    const result = await createMockClient().rpc("get_note_content_link_states", {
      p_note_ids: ["foreign-note"],
      p_reading_item_ids: [],
    });

    expect(result.data[0]).toMatchObject({
      resource_type: "note",
      resource_id: "foreign-note",
      title: null,
      state: "missing",
    });
  });
});
