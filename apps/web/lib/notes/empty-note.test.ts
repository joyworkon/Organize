import { describe, expect, it } from "vitest";
import { isEmptyDoc, shouldDiscardEmptyNote } from "./empty-note";

const now = Date.parse("2026-10-11T12:00:00Z");
const base = {
  isOwner: true,
  loadedEmpty: true,
  title: "",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  hasChildren: false,
  createdAt: "2026-10-11T11:55:00Z",
  now,
};

describe("isEmptyDoc", () => {
  it("空文档 / 空段落 / 空白文本视为空", () => {
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "  " }] }] })).toBe(true);
  });
  it("有文字或非文本块视为非空", () => {
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] })).toBe(false);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "horizontalRule" }] })).toBe(false);
  });
});

describe("shouldDiscardEmptyNote", () => {
  it("新建后未编辑的空笔记会被丢弃", () => {
    expect(shouldDiscardEmptyNote(base)).toBe(true);
  });
  it("任何不确定条件都保留", () => {
    expect(shouldDiscardEmptyNote({ ...base, isOwner: false })).toBe(false);
    expect(shouldDiscardEmptyNote({ ...base, loadedEmpty: false })).toBe(false);
    expect(shouldDiscardEmptyNote({ ...base, title: "标题" })).toBe(false);
    expect(shouldDiscardEmptyNote({ ...base, hasChildren: true })).toBe(false);
    expect(shouldDiscardEmptyNote({ ...base, createdAt: null })).toBe(false);
    expect(shouldDiscardEmptyNote({ ...base, createdAt: "2026-10-11T09:00:00Z" })).toBe(false);
    expect(
      shouldDiscardEmptyNote({ ...base, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] } })
    ).toBe(false);
  });
});
