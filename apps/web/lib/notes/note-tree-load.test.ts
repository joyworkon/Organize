import { describe, it, expect } from "vitest";
import {
  NOTE_TREE_LOAD_ERROR_MESSAGE,
  nextNoteTreeAfterLoad,
  hasChildrenForDiscard,
  type NoteTreeRow,
} from "./note-tree-load";
import type { NoteTreeItem } from "@/lib/notes/tree";

const rowA: NoteTreeRow = {
  id: "note-a",
  title: "读书笔记",
  icon: "📚",
  parent_note_id: null,
  updated_at: "2026-10-17T00:00:00Z",
};
const rowB: NoteTreeRow = {
  id: "note-b",
  title: "",
  icon: "",
  parent_note_id: "note-a",
  updated_at: "2026-10-16T00:00:00Z",
};

const previousSnapshot: NoteTreeItem[] = [
  { id: "note-old", title: "旧快照", icon: null, parent_note_id: null, updated_at: "2026-10-01T00:00:00Z" },
];

describe("nextNoteTreeAfterLoad", () => {
  it("成功加载：用新数据整体替换并清错，字段映射与旧行为一致（空 title/icon 转 null）", () => {
    const plan = nextNoteTreeAfterLoad({ previous: previousSnapshot, data: [rowA, rowB], error: null });
    expect(plan.notes).toEqual([
      { id: "note-a", title: "读书笔记", icon: "📚", parent_note_id: null, updated_at: "2026-10-17T00:00:00Z" },
      { id: "note-b", title: null, icon: null, parent_note_id: "note-a", updated_at: "2026-10-16T00:00:00Z" },
    ]);
    expect(plan.loadError).toBeNull();
    expect(plan.reliable).toBe(true);
  });

  it("成功且 data 为 null（真·没有笔记）：得到空数组、无错、可靠", () => {
    const plan = nextNoteTreeAfterLoad({ previous: previousSnapshot, data: null, error: null });
    expect(plan.notes).toEqual([]);
    expect(plan.loadError).toBeNull();
    expect(plan.reliable).toBe(true);
  });

  it("加载失败：保留上次成功快照并设置 loadError、reliable=false，不得清空伪装成「没有笔记」", () => {
    const plan = nextNoteTreeAfterLoad({
      previous: previousSnapshot,
      data: null,
      error: { code: "PGRST-500", message: "boom" },
    });
    expect(plan.notes).toEqual(previousSnapshot);
    expect(plan.notes).toBe(previousSnapshot); // 同引用返回，React 重设可跳过重渲染
    expect(plan.loadError).toBe(NOTE_TREE_LOAD_ERROR_MESSAGE);
    expect(plan.reliable).toBe(false);
  });

  it("失败后再成功：恢复为用新数据替换并清错", () => {
    const failed = nextNoteTreeAfterLoad({ previous: previousSnapshot, data: null, error: new Error("net") });
    const recovered = nextNoteTreeAfterLoad({ previous: failed.notes, data: [rowA], error: null });
    expect(recovered.notes).toEqual([
      { id: "note-a", title: "读书笔记", icon: "📚", parent_note_id: null, updated_at: "2026-10-17T00:00:00Z" },
    ]);
    expect(recovered.loadError).toBeNull();
    expect(recovered.reliable).toBe(true);
  });
});

describe("hasChildrenForDiscard", () => {
  const notes: NoteTreeItem[] = [
    { id: "parent", title: "父页面", icon: null, parent_note_id: null },
    { id: "child", title: "子页面", icon: null, parent_note_id: "parent" },
  ];

  it("快照不可靠（从未成功加载或最近一次失败）：视为「不确定 → 有子页面」，保留笔记", () => {
    expect(hasChildrenForDiscard({ notes: [], noteId: "parent", reliable: false })).toBe(true);
    expect(hasChildrenForDiscard({ notes, noteId: "parent", reliable: false })).toBe(true);
  });

  it("快照可靠且确有子页面：true", () => {
    expect(hasChildrenForDiscard({ notes, noteId: "parent", reliable: true })).toBe(true);
  });

  it("快照可靠且确实没有子页面：false（成功路径行为不变）", () => {
    expect(hasChildrenForDiscard({ notes, noteId: "orphan", reliable: true })).toBe(false);
  });
});
