import { describe, expect, it } from "vitest";
import {
  INITIAL_PAGE_COMMENTS_DRAFT,
  nextDraftOnNoteSwitch,
  shouldApplyCommentResult,
} from "./note-page-comments-state";

describe("shouldApplyCommentResult", () => {
  it("同一 noteId 且轮次最新时允许写回", () => {
    expect(
      shouldApplyCommentResult({ noteId: "note-a", seq: 3 }, "note-a", 3),
    ).toBe(true);
  });

  it("旧 generation（已有更新一轮加载）的结果应丢弃", () => {
    // 笔记 A 的第一轮加载还没返回，组件已因切换/重试开始了第二轮
    expect(
      shouldApplyCommentResult({ noteId: "note-a", seq: 1 }, "note-a", 2),
    ).toBe(false);
  });

  it("发起时的 noteId 已不是当前笔记时，即使轮次匹配也应丢弃", () => {
    // 切到笔记 B 后，A 的慢请求返回：seq 可能仍是最新（B 的新加载尚未开始），
    // 但 noteId 不匹配，同样不得写回
    expect(
      shouldApplyCommentResult({ noteId: "note-a", seq: 2 }, "note-b", 2),
    ).toBe(false);
  });

  it("切回原笔记（A→B→A）时旧结果按轮次丢弃", () => {
    // A 的请求在 A→B→A 期间返回：noteId 相同但期间已产生新轮次
    expect(
      shouldApplyCommentResult({ noteId: "note-a", seq: 1 }, "note-a", 3),
    ).toBe(false);
  });
});

describe("nextDraftOnNoteSwitch", () => {
  it("切换笔记时草稿回到初始值（不带草稿/回复目标/旧错误）", () => {
    expect(
      nextDraftOnNoteSwitch("note-a", "note-b", {
        text: "上一篇的草稿",
        replyTo: "thread-1",
        error: "评论发送失败，请稍后重试",
      }),
    ).toEqual(INITIAL_PAGE_COMMENTS_DRAFT);
  });

  it("同一笔记内重复调用保持原草稿不变", () => {
    const draft = { text: "输入中", replyTo: "thread-1", error: "" };
    expect(nextDraftOnNoteSwitch("note-a", "note-a", draft)).toBe(draft);
  });
});
