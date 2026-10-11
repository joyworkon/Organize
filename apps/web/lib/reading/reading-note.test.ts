import { describe, expect, it } from "vitest";
import { buildReadingNoteContent, readingNoteTitle } from "./reading-note";

describe("reading note", () => {
  it("标题使用文章标题，缺省回退 URL", () => {
    expect(readingNoteTitle({ title: "深度工作", url: "https://a.com" })).toBe("读《深度工作》的笔记");
    expect(readingNoteTitle({ title: " ", url: "https://a.com" })).toBe("读《https://a.com》的笔记");
  });
  it("初稿包含原文链接、摘录与「我的想法」", () => {
    const doc = buildReadingNoteContent(
      { id: "1", title: "t", url: "https://a.com", isInternal: false },
      [{ content: "一句话", note: "批注内容" }]
    );
    const json = JSON.stringify(doc);
    expect(json).toContain("https://a.com");
    expect(json).toContain("摘录");
    expect(json).toContain("一句话");
    expect(json).toContain("批注：批注内容");
    expect(json).toContain("我的想法");
  });
  it("没有高亮时不生成摘录小节", () => {
    const doc = buildReadingNoteContent({ id: "1", title: "t", url: "urn:x", isInternal: true }, []);
    expect(JSON.stringify(doc)).not.toContain("摘录");
    expect(JSON.stringify(doc)).toContain("/library/1");
  });
});
