// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMOJI_RECENTS_LIMIT, EMOJI_RECENTS_STORAGE_KEY, readRecentEmojis, rememberEmoji } from "./emoji-recents";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("emoji recents（最近使用）", () => {
  it("uses an organize: prefixed key, keeps the newest first, dedupes and caps at eight", () => {
    expect(EMOJI_RECENTS_STORAGE_KEY.startsWith("organize:")).toBe(true);
    for (const emoji of ["😀", "😁", "😂", "😀", "🤣", "😅", "😊", "😍", "😘"]) rememberEmoji(emoji);
    expect(readRecentEmojis()).toEqual(["😘", "😍", "😊", "😅", "🤣", "😀", "😂", "😁"]);
    expect(readRecentEmojis()).toHaveLength(EMOJI_RECENTS_LIMIT);
    rememberEmoji("");
    expect(readRecentEmojis()).toHaveLength(EMOJI_RECENTS_LIMIT);
  });

  it("ignores malformed storage and survives blocked or full storage", () => {
    for (const value of ["bad json", "null", "3", '{"emoji":"x"}', '["😀", 1, "", null, "😀", "😁"]']) {
      localStorage.setItem(EMOJI_RECENTS_STORAGE_KEY, value);
      expect(readRecentEmojis()).toEqual(value.startsWith("[") ? ["😀", "😁"] : []);
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(readRecentEmojis()).toEqual([]);
    expect(() => rememberEmoji("😀")).not.toThrow();
  });
});
