import { describe, expect, it } from "vitest";
import {
  areNoteDraftsEqual,
  clearLocalNoteDraft,
  clearLocalNoteDraftForNote,
  noteDraftStorageKey,
  readLocalNoteDraft,
  writeLocalNoteDraft,
  type NoteDraftSnapshot,
} from "./local-draft";

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
}

const draft: NoteDraftSnapshot = {
  title: "未保存标题",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  icon: null,
  cover_url: null,
  cover_position: 50,
  parent_note_id: null,
  full_width: false,
  font_family: "default",
  small_font: false,
};

describe("local note draft", () => {
  it("按用户和笔记隔离，并完整恢复 revision 与页面快照", () => {
    const storage = new MemoryStorage();
    const stored = writeLocalNoteDraft(
      storage,
      "user-1",
      "note-1",
      7,
      draft,
      new Date("2026-08-20T10:00:00Z")
    );

    expect(stored?.updatedAt).toBe("2026-08-20T10:00:00.000Z");
    expect(readLocalNoteDraft(storage, "user-1", "note-1")).toEqual(stored);
    expect(readLocalNoteDraft(storage, "user-2", "note-1")).toBeNull();
  });

  it("拒绝损坏或结构不完整的数据", () => {
    const storage = new MemoryStorage();
    storage.setItem(noteDraftStorageKey("user-1", "note-1"), "{bad-json");
    expect(readLocalNoteDraft(storage, "user-1", "note-1")).toBeNull();

    storage.setItem(
      noteDraftStorageKey("user-1", "note-1"),
      JSON.stringify({ version: 1, noteId: "note-1", userId: "user-1" })
    );
    expect(readLocalNoteDraft(storage, "user-1", "note-1")).toBeNull();
  });

  it("保存成功只清理当前用户草稿，历史恢复可清理该笔记所有用户键", () => {
    const storage = new MemoryStorage();
    writeLocalNoteDraft(storage, "user-1", "note-1", 1, draft);
    writeLocalNoteDraft(storage, "user-2", "note-1", 1, draft);
    writeLocalNoteDraft(storage, "user-1", "note-2", 1, draft);

    clearLocalNoteDraft(storage, "user-1", "note-1");
    expect(readLocalNoteDraft(storage, "user-1", "note-1")).toBeNull();
    expect(readLocalNoteDraft(storage, "user-2", "note-1")).not.toBeNull();

    clearLocalNoteDraftForNote(storage, "note-1");
    expect(readLocalNoteDraft(storage, "user-2", "note-1")).toBeNull();
    expect(readLocalNoteDraft(storage, "user-1", "note-2")).not.toBeNull();
  });

  it("快照比较能区分旧草稿与数据库当前值", () => {
    expect(areNoteDraftsEqual(draft, { ...draft })).toBe(true);
    expect(areNoteDraftsEqual(draft, { ...draft, title: "远端标题" })).toBe(false);
  });
});
