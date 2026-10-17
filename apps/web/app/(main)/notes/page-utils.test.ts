import { describe, it, expect } from "vitest";
import type { NoteWithTags } from "@organize/shared";
import {
  SORT_FIELD_LABEL,
  SORT_ORDER_LABEL,
  sortSummary,
  applyPinned,
  applyPinnedBatch,
  planTagFilter,
  removeNotes,
  sortNotesLocal,
  persistNoteMove,
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

describe("排序文案单源", () => {
  it("三个字段与两个顺序都有文案", () => {
    expect(Object.keys(SORT_FIELD_LABEL).sort()).toEqual(["created_at", "title", "updated_at"]);
    expect(Object.keys(SORT_ORDER_LABEL).sort()).toEqual(["asc", "desc"]);
  });

  it("sortSummary 拼出触发器标签", () => {
    expect(sortSummary("updated_at", "desc")).toBe("更新时间 · 降序");
    expect(sortSummary("title", "asc")).toBe("标题 · 升序");
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


describe("sortNotesLocal（置顶后立即重排）", () => {
  const n = (id: string, pinned: boolean, updatedAt: string): NoteWithTags =>
    ({ ...makeNote(id, pinned), updated_at: updatedAt } as NoteWithTags);

  it("置顶后跳到最前，其余保持更新时间降序", () => {
    const notes = [
      n("a", false, "2026-07-03T00:00:00Z"),
      n("b", false, "2026-07-02T00:00:00Z"),
      n("c", true, "2026-07-01T00:00:00Z"),
    ];
    // 把 b 置顶（b 比 c 新，置顶组内按更新时间降序）
    const result = sortNotesLocal(applyPinned(notes, "b", true), "updated_at", "desc");
    expect(result.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("取消置顶后按排序字段回到正常位置", () => {
    const notes = [
      n("a", true, "2026-07-01T00:00:00Z"),
      n("b", false, "2026-07-03T00:00:00Z"),
      n("c", false, "2026-07-02T00:00:00Z"),
    ];
    const result = sortNotesLocal(applyPinned(notes, "a", false), "updated_at", "desc");
    expect(result.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("标题升序排序在同组内生效", () => {
    const a = { ...makeNote("a", false), title: "bbb" } as NoteWithTags;
    const b = { ...makeNote("b", false), title: "aaa" } as NoteWithTags;
    const result = sortNotesLocal([a, b], "title", "asc");
    expect(result.map((x) => x.title)).toEqual(["aaa", "bbb"]);
  });
});

describe("planTagFilter（标签筛选三态判定）", () => {
  it("查询 error → failed：走失败分支，不返回清空指令", () => {
    expect(planTagFilter({ data: null, error: new Error("network down") })).toEqual({
      status: "failed",
    });
    // supabase-js 出错时 data 为 null；防御性验证：即便带了行，error 事实优先
    expect(planTagFilter({ data: [{ note_id: "a" }], error: { message: "denied" } })).toEqual({
      status: "failed",
    });
  });

  it("查询成功但 0 行（或 data 为 null）→ empty：清空列表（现状行为）", () => {
    expect(planTagFilter({ data: [], error: null })).toEqual({ status: "empty" });
    expect(planTagFilter({ data: null, error: null })).toEqual({ status: "empty" });
  });

  it("有行 → ok：返回去重后的 scopedIds", () => {
    expect(
      planTagFilter({ data: [{ note_id: "a" }, { note_id: "b" }, { note_id: "a" }], error: null })
    ).toEqual({ status: "ok", scopedIds: ["a", "b"] });
  });
});

describe("persistNoteMove", () => {
  function fakeClient(order: string[], updateError: unknown = null) {
    return {
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => { order.push("read"); return { data: { content_revision: 4 } }; } }) }),
        update: (patch: { parent_note_id: string | null; content_revision: number }) => ({
          eq: async () => {
            await new Promise((r) => setTimeout(r, 5));
            order.push(`update:${patch.parent_note_id}:${patch.content_revision}`);
            return { error: updateError };
          },
        }),
      }),
    };
  }
  it("notifies only after the write commits and bumps the revision", async () => {
    const order: string[] = [];
    await persistNoteMove(fakeClient(order), "n1", "p1", () => order.push("notify"));
    expect(order).toEqual(["read", "update:p1:5", "notify"]);
  });
  it("does not notify and rethrows when the write fails", async () => {
    const order: string[] = [];
    const err = new Error("denied");
    await expect(persistNoteMove(fakeClient(order, err), "n1", null, () => order.push("notify"))).rejects.toBe(err);
    expect(order).not.toContain("notify");
  });
});
