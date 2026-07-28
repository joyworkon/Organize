import { describe, it, expect } from "vitest";
import type { NoteWithTags } from "@organize/shared";
import {
  nextSortField,
  applyPinned,
  applyPinnedBatch,
  removeNotes,
} from "./page-utils";

function makeNote(id: string, pinned = false): NoteWithTags {
  return {
    id,
    user_id: "u1",
    reading_item_id: null,
    title: `note-${id}`,
    content: { type: "doc" },
    is_pinned: pinned,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  } as NoteWithTags;
}

describe("nextSortField", () => {
  it("按 updated_at → created_at → title → updated_at 循环", () => {
    expect(nextSortField("updated_at")).toBe("created_at");
    expect(nextSortField("created_at")).toBe("title");
    expect(nextSortField("title")).toBe("updated_at");
  });
});

describe("applyPinned", () => {
  it("只更新目标笔记的置顶状态，且不可变更新", () => {
    const notes = [makeNote("a"), makeNote("b")];
    const result = applyPinned(notes, "a", true);
    expect(result.find((n) => n.id === "a")?.is_pinned).toBe(true);
    expect(result.find((n) => n.id === "b")?.is_pinned).toBe(false);
    // 原数组不被修改（乐观更新失败后回滚依赖这一点）
    expect(notes[0].is_pinned).toBe(false);
    expect(result).not.toBe(notes);
  });

  it("反向调用可回滚到原状态", () => {
    const notes = [makeNote("a")];
    const optimistic = applyPinned(notes, "a", true);
    const rolledBack = applyPinned(optimistic, "a", false);
    expect(rolledBack[0].is_pinned).toBe(false);
  });
});

describe("applyPinnedBatch", () => {
  it("批量更新选中集合内的笔记", () => {
    const notes = [makeNote("a"), makeNote("b"), makeNote("c")];
    const result = applyPinnedBatch(notes, new Set(["a", "c"]), true);
    expect(result.map((n) => n.is_pinned)).toEqual([true, false, true]);
  });
});

describe("removeNotes", () => {
  it("移除集合内的笔记，保留其余", () => {
    const notes = [makeNote("a"), makeNote("b"), makeNote("c")];
    const result = removeNotes(notes, new Set(["b"]));
    expect(result.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("空集合不改变列表内容", () => {
    const notes = [makeNote("a")];
    expect(removeNotes(notes, new Set())).toHaveLength(1);
  });
});
