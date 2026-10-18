import { describe, it, expect } from "vitest";
import {
  SIDEBAR_NOTE_TREE_LOAD_ERROR_MESSAGE,
  nextSidebarNoteTreeAfterLoad,
  type SidebarNoteRow,
} from "./sidebar-note-tree-load";

const rowA: SidebarNoteRow = {
  id: "note-a",
  title: "读书笔记",
  icon: "📚",
  parent_note_id: null,
  updated_at: "2026-10-17T00:00:00Z",
  is_pinned: true,
};
const rowB: SidebarNoteRow = {
  id: "note-b",
  title: "",
  icon: "",
  parent_note_id: "note-a",
  updated_at: "2026-10-16T00:00:00Z",
  is_pinned: null,
};
const rowC: SidebarNoteRow = {
  id: "note-c",
  title: null,
  icon: null,
  parent_note_id: null,
  updated_at: "2026-10-15T00:00:00Z",
  // is_pinned 缺省（旧行为依赖 !!undefined → false）
};

const previousRows = [
  {
    id: "note-old",
    title: "旧快照",
    icon: null,
    parent_note_id: null,
    updated_at: "2026-10-01T00:00:00Z",
    is_pinned: false,
  },
];

describe("nextSidebarNoteTreeAfterLoad", () => {
  it("成功加载：字段映射与旧行为完全一致（空 title/icon 转 null，is_pinned 缺省/为 null 时为 false）", () => {
    const plan = nextSidebarNoteTreeAfterLoad({
      previous: previousRows,
      data: [rowA, rowB, rowC],
      error: null,
    });
    expect(plan.rows).toEqual([
      {
        id: "note-a",
        title: "读书笔记",
        icon: "📚",
        parent_note_id: null,
        updated_at: "2026-10-17T00:00:00Z",
        is_pinned: true,
      },
      {
        id: "note-b",
        title: null,
        icon: null,
        parent_note_id: "note-a",
        updated_at: "2026-10-16T00:00:00Z",
        is_pinned: false,
      },
      {
        id: "note-c",
        title: null,
        icon: null,
        parent_note_id: null,
        updated_at: "2026-10-15T00:00:00Z",
        is_pinned: false,
      },
    ]);
    expect(plan.loadError).toBeNull();
  });

  it("成功且 data 为 null（真·没有笔记）：得到空数组、无错", () => {
    const plan = nextSidebarNoteTreeAfterLoad({ previous: previousRows, data: null, error: null });
    expect(plan.rows).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("加载失败且有上次快照：rows 同引用返回 + 错误文案，不得清空伪装成「还没有笔记」", () => {
    const plan = nextSidebarNoteTreeAfterLoad({
      previous: previousRows,
      data: null,
      error: { code: "PGRST-500", message: "boom" },
    });
    expect(plan.rows).toBe(previousRows); // 同引用，调用方据此不覆盖树
    expect(plan.loadError).toBe(SIDEBAR_NOTE_TREE_LOAD_ERROR_MESSAGE);
  });

  it("加载失败且从未成功过（previous 为 null）：rows 为 null、有错误文案", () => {
    const plan = nextSidebarNoteTreeAfterLoad({
      previous: null,
      data: null,
      error: new Error("net down"),
    });
    expect(plan.rows).toBeNull();
    expect(plan.loadError).toBe(SIDEBAR_NOTE_TREE_LOAD_ERROR_MESSAGE);
  });

  it("失败后再成功：恢复为用新数据替换并清错", () => {
    const failed = nextSidebarNoteTreeAfterLoad({ previous: null, data: null, error: new Error("net") });
    const recovered = nextSidebarNoteTreeAfterLoad({
      previous: failed.rows,
      data: [rowA],
      error: null,
    });
    expect(recovered.rows).toEqual([
      {
        id: "note-a",
        title: "读书笔记",
        icon: "📚",
        parent_note_id: null,
        updated_at: "2026-10-17T00:00:00Z",
        is_pinned: true,
      },
    ]);
    expect(recovered.loadError).toBeNull();
  });
});
