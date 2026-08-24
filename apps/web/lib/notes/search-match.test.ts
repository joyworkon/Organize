import { describe, expect, it } from "vitest";
import { findNoteSearchMatch } from "./search-match";

describe("findNoteSearchMatch", () => {
  it("返回正文命中的可定位块和上下文", () => {
    const match = findNoteSearchMatch(
      {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { id: "intro" }, content: [{ type: "text", text: "开头内容" }] },
          {
            type: "paragraph",
            attrs: { id: "target" },
            content: [{ type: "text", text: `${"前".repeat(60)}关键字${"后".repeat(60)}` }],
          },
        ],
      },
      "关键字"
    );

    expect(match?.blockId).toBe("target");
    expect(match?.snippet.startsWith("…")).toBe(true);
    expect(match?.snippet.endsWith("…")).toBe(true);
    expect(match?.snippet.slice(match.matchStart, match.matchEnd)).toBe("关键字");
  });

  it("嵌套块命中时选择更精确的子块", () => {
    const match = findNoteSearchMatch(
      {
        type: "doc",
        content: [
          {
            type: "taskItem",
            attrs: { id: "task" },
            content: [
              {
                type: "paragraph",
                attrs: { id: "task-paragraph" },
                content: [{ type: "text", text: "完成搜索验收" }],
              },
            ],
          },
        ],
      },
      "搜索"
    );

    expect(match?.blockId).toBe("task-paragraph");
  });

  it("历史块没有 id 时保留片段但退化为普通笔记链接", () => {
    const match = findNoteSearchMatch(
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "历史正文命中" }] }],
      },
      "正文"
    );

    expect(match?.blockId).toBeNull();
    expect(match?.snippet.slice(match.matchStart, match.matchEnd)).toBe("正文");
  });

  it("空查询或无正文命中时返回 null", () => {
    expect(findNoteSearchMatch({ type: "doc" }, " ")).toBeNull();
    expect(
      findNoteSearchMatch(
        { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] },
        "不存在"
      )
    ).toBeNull();
  });
});
