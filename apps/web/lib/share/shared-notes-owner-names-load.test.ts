import { describe, expect, it } from "vitest";

import {
  nextSharedNoteOwnerProfilesAfterLoad,
  SHARED_NOTES_OWNER_NAMES_LOAD_ERROR_MESSAGE,
  type SharedNoteOwnerProfileRow,
  type SharedNoteOwnerSnapshot,
} from "./shared-notes-owner-names-load";

const profileRow = (
  id: string,
  displayName: string | null = `用户-${id}`,
  avatarUrl: string | null = null
): SharedNoteOwnerProfileRow => ({
  id,
  display_name: displayName,
  avatar_url: avatarUrl,
});

const note = (
  ownerId: string,
  ownerName: string | null = `用户-${ownerId}`,
  ownerAvatarUrl: string | null = null
): SharedNoteOwnerSnapshot => ({
  ownerId,
  ownerName,
  ownerAvatarUrl,
});

describe("nextSharedNoteOwnerProfilesAfterLoad", () => {
  it("成功时用查询结果建 Map 并清除错误", () => {
    const result = nextSharedNoteOwnerProfilesAfterLoad({
      previousNotes: [note("old")],
      data: [profileRow("alice", "Alice", "https://example.com/a.png")],
      error: null,
    });

    expect(result.loadError).toBeNull();
    expect(result.profiles.get("alice")).toEqual({
      display_name: "Alice",
      avatar_url: "https://example.com/a.png",
    });
    expect(result.profiles.has("old")).toBe(false);
  });

  it("查询失败时从上次列表回填姓名/头像并返回服务端错误消息", () => {
    const result = nextSharedNoteOwnerProfilesAfterLoad({
      previousNotes: [
        note("alice", "Alice", "https://example.com/a.png"),
        note("bob", "Bob"),
      ],
      data: null,
      error: { message: "  permission denied  " },
    });

    expect(result.loadError).toBe("permission denied");
    expect(result.profiles.get("alice")).toEqual({
      display_name: "Alice",
      avatar_url: "https://example.com/a.png",
    });
    expect(result.profiles.get("bob")).toEqual({ display_name: "Bob", avatar_url: null });
  });

  it("错误消息为空白时回退到统一提示", () => {
    const result = nextSharedNoteOwnerProfilesAfterLoad({
      previousNotes: [note("alice")],
      data: null,
      error: { message: "   " },
    });

    expect(result.loadError).toBe(SHARED_NOTES_OWNER_NAMES_LOAD_ERROR_MESSAGE);
  });

  it("data 为 null 即使没有 error 也按失败处理并回填上次姓名", () => {
    const result = nextSharedNoteOwnerProfilesAfterLoad({
      previousNotes: [note("alice", "Alice")],
      data: null,
      error: null,
    });

    expect(result.loadError).toBe(SHARED_NOTES_OWNER_NAMES_LOAD_ERROR_MESSAGE);
    expect(result.profiles.get("alice")).toEqual({
      display_name: "Alice",
      avatar_url: null,
    });
  });

  it("成功返回空数组是真实空态而不是失败", () => {
    const result = nextSharedNoteOwnerProfilesAfterLoad({
      previousNotes: [note("old", "Old")],
      data: [],
      error: null,
    });

    expect(result.loadError).toBeNull();
    expect(result.profiles.size).toBe(0);
  });

  it("回填时同一属主取第一条非空值，全空条目不写入 Map", () => {
    const result = nextSharedNoteOwnerProfilesAfterLoad({
      previousNotes: [
        note("alice", "Alice"),
        note("alice", "不应覆盖"),
        note("bob", null, null),
      ],
      data: null,
      error: { message: "network down" },
    });

    expect(result.loadError).toBe("network down");
    expect(result.profiles.get("alice")).toEqual({
      display_name: "Alice",
      avatar_url: null,
    });
    expect(result.profiles.has("bob")).toBe(false);
  });
});
