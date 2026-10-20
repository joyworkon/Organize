// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SLASH_RECENT_LIMIT,
  SLASH_RECENT_STORAGE_KEY,
  pickRecentCommands,
  readRecentSlashCommands,
  rememberSlashCommand,
} from "./slash-recent-commands";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("slash recent commands（最近使用）", () => {
  it("uses an organize: prefixed key, keeps the newest first, dedupes and caps at five", () => {
    expect(SLASH_RECENT_STORAGE_KEY.startsWith("organize:")).toBe(true);
    for (const id of ["a", "b", "c", "a", "d", "e", "f"]) rememberSlashCommand(id);
    expect(readRecentSlashCommands()).toEqual(["f", "e", "d", "a", "c"]);
    expect(readRecentSlashCommands()).toHaveLength(SLASH_RECENT_LIMIT);
    rememberSlashCommand("");
    expect(readRecentSlashCommands()).toEqual(["f", "e", "d", "a", "c"]);
  });

  it("ignores malformed storage and survives blocked or full storage", () => {
    for (const value of ["bad json", "null", "3", '{"id":"x"}', '["a", 1, "", null, "a", "b"]']) {
      localStorage.setItem(SLASH_RECENT_STORAGE_KEY, value);
      expect(readRecentSlashCommands()).toEqual(value.startsWith("[") ? ["a", "b"] : []);
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    expect(readRecentSlashCommands()).toEqual([]);
    expect(() => rememberSlashCommand("a")).not.toThrow();
  });

  it("picks commands in recent order only from the candidates the current menu can run", () => {
    const candidates = [{ id: "paragraph" }, { id: "heading-1" }, { id: "task-list" }];
    expect(pickRecentCommands(["task-list", "columns-2", "heading-1", "task-list"], candidates)).toEqual([
      { id: "task-list" },
      { id: "heading-1" },
    ]);
    expect(pickRecentCommands(["paragraph", "heading-1", "task-list"], candidates, 2)).toEqual([
      { id: "paragraph" },
      { id: "heading-1" },
    ]);
    expect(pickRecentCommands([], candidates)).toEqual([]);
  });
});
