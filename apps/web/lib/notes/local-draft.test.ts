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
    const result = writeLocalNoteDraft(
      storage,
      "user-1",
      "note-1",
      7,
      draft,
      new Date("2026-08-20T10:00:00Z")
    );

    expect(result.status).toBe("ok");
    expect(result.stored?.updatedAt).toBe("2026-08-20T10:00:00.000Z");
    expect(readLocalNoteDraft(storage, "user-1", "note-1")).toEqual(result.stored);
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

describe("writeLocalNoteDraft：类型化失败结果", () => {
  class FailingStorage {
    get length() {
      return 0;
    }
    getItem() {
      return null;
    }
    key() {
      return null;
    }
    removeItem() {}
    setItem() {
      const error = new DOMException("storage full", "QuotaExceededError");
      throw error;
    }
  }

  class UnavailableStorage {
    get length() {
      return 0;
    }
    getItem() {
      return null;
    }
    key() {
      return null;
    }
    removeItem() {}
    setItem() {
      throw new Error("access denied");
    }
  }

  it("QuotaExceededError 分类为 quota，且不抛出、不返回伪成功", () => {
    const result = writeLocalNoteDraft(new FailingStorage(), "u", "n", 1, draft);
    expect(result.status).toBe("quota");
    expect(result.stored).toBeNull();
  });

  it("其他存储异常保守分类为 unavailable", () => {
    const result = writeLocalNoteDraft(new UnavailableStorage(), "u", "n", 1, draft);
    expect(result.status).toBe("unavailable");
    expect(result.stored).toBeNull();
  });

  it("无法序列化的内容分类为 serialization", () => {
    const circular: Record<string, unknown> = { type: "doc" };
    circular["self"] = circular;
    const storage = new MemoryStorage();
    const result = writeLocalNoteDraft(storage, "u", "n", 1, {
      ...draft,
      content: circular as NoteDraftSnapshot["content"],
    });
    expect(result.status).toBe("serialization");
    expect(result.stored).toBeNull();
    // 未写入任何半成品数据
    expect(readLocalNoteDraft(storage, "u", "n")).toBeNull();
  });

  it("成功 storage 返回 ok 并可读回", () => {
    const storage = new MemoryStorage();
    const result = writeLocalNoteDraft(storage, "u", "n", 3, draft);
    expect(result.status).toBe("ok");
    expect(readLocalNoteDraft(storage, "u", "n")).toEqual(result.stored);
  });
});
