import { describe, expect, it } from "vitest";

import {
  buildMemoConversions,
  MEMO_CONVERSIONS_ERROR_HINT,
  resolveMemoConversionsLoad,
  type MemoConversion,
} from "./conversions";

describe("buildMemoConversions", () => {
  it("正常构造：memo_id → 关联笔记状态，已删除笔记 noteDeleted 为 true", () => {
    const conversions = buildMemoConversions(
      [
        { memo_id: "m1", note_id: "n1" },
        { memo_id: "m2", note_id: "n2" },
      ],
      [
        { id: "n1", title: "第一条笔记", deleted_at: null },
        { id: "n2", title: "已删笔记", deleted_at: "2026-10-18T00:00:00Z" },
      ]
    );
    expect(conversions.size).toBe(2);
    expect(conversions.get("m1")).toEqual({
      noteId: "n1",
      noteTitle: "第一条笔记",
      noteDeleted: false,
    });
    expect(conversions.get("m2")).toEqual({
      noteId: "n2",
      noteTitle: "已删笔记",
      noteDeleted: true,
    });
  });

  it("找不到对应 note 的 link → noteTitle null / noteDeleted false", () => {
    const conversions = buildMemoConversions([{ memo_id: "m1", note_id: "ghost" }], [
      { id: "n1", title: "别的笔记", deleted_at: null },
    ]);
    expect(conversions.get("m1")).toEqual({ noteId: "ghost", noteTitle: null, noteDeleted: false });
  });

  it("links 为空数组 → 空 Map", () => {
    expect(buildMemoConversions([], [{ id: "n1", title: null, deleted_at: null }]).size).toBe(0);
  });

  it("note title 为 null 时保留 null，deleted_at 为 null 时 noteDeleted 为 false", () => {
    const conversions = buildMemoConversions(
      [{ memo_id: "m1", note_id: "n1" }],
      [{ id: "n1", title: null, deleted_at: null }]
    );
    expect(conversions.get("m1")).toEqual({ noteId: "n1", noteTitle: null, noteDeleted: false });
  });
});

describe("resolveMemoConversionsLoad", () => {
  const links = [{ memo_id: "m1", note_id: "n1" }];
  const notes = [{ id: "n1", title: "笔记", deleted_at: null }];
  const previous = new Map<string, MemoConversion>([
    ["m1", { noteId: "n1", noteTitle: "上次结果", noteDeleted: false }],
  ]);

  it("两查询都成功 → ok true 且按当前数据重建", () => {
    const result = resolveMemoConversionsLoad({ links, notes, previous });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conversions.get("m1")?.noteTitle).toBe("笔记");
    }
  });

  it("links 为空且无错误 → ok true 且空 Map", () => {
    const result = resolveMemoConversionsLoad({ links: [], notes: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conversions.size).toBe(0);
    }
  });

  it("linksError → ok false 且返回的就是 previous（保留上次结果，不清空）", () => {
    const result = resolveMemoConversionsLoad({
      links: null,
      linksError: new Error("network"),
      previous,
    });
    expect(result.ok).toBe(false);
    expect(result.conversions).toBe(previous);
    expect(result.conversions.get("m1")?.noteTitle).toBe("上次结果");
  });

  it("notesError → ok false 且返回 previous", () => {
    const result = resolveMemoConversionsLoad({ links, notes: null, notesError: new Error("boom"), previous });
    expect(result.ok).toBe(false);
    expect(result.conversions).toBe(previous);
  });

  it("失败且没有 previous → ok false 且空 Map（后续成功仍可恢复）", () => {
    const result = resolveMemoConversionsLoad({ links, linksError: new Error("x") });
    expect(result.ok).toBe(false);
    expect(result.conversions.size).toBe(0);
  });

  it("error 为 undefined（如 mock 不返回 error 字段）视同无错误", () => {
    const result = resolveMemoConversionsLoad({ links, notes });
    expect(result.ok).toBe(true);
  });

  it("失败提示常量为非空中文文案", () => {
    expect(MEMO_CONVERSIONS_ERROR_HINT.length).toBeGreaterThan(0);
  });
});
