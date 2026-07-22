import { describe, expect, it } from "vitest";
import {
  buildPresentationSlides,
  isAllowedAIContent,
  isSameNodeSnapshot,
  stripBlockIds,
} from "./block-utils";

describe("block utilities", () => {
  it("clears every nested block id before duplication", () => {
    const copy = stripBlockIds({
      type: "bulletList",
      content: [{
        type: "listItem",
        attrs: { id: "item-1" },
        content: [{ type: "paragraph", attrs: { id: "paragraph-1" } }],
      }],
    });

    expect(copy.content?.[0].attrs?.id).toBeNull();
    expect(copy.content?.[0].content?.[0].attrs?.id).toBeNull();
  });

  it("compares JSONB snapshots without depending on object key order", () => {
    const editorNode = {
      type: "heading",
      attrs: { id: "block-1", level: 1, backgroundColor: null },
    };
    const databaseNode = {
      attrs: { backgroundColor: null, level: 1, id: "block-1" },
      type: "heading",
    };

    expect(isSameNodeSnapshot(editorNode, databaseNode)).toBe(true);
    expect(isSameNodeSnapshot(editorNode, { ...databaseNode, attrs: { ...databaseNode.attrs, level: 2 } })).toBe(false);
  });

  it("groups presentation slides from the selected block using H1/H2 boundaries", () => {
    const slides = buildPresentationSlides({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "intro" }, content: [{ type: "text", text: "忽略" }] },
        { type: "heading", attrs: { id: "chapter-1", level: 1 }, content: [{ type: "text", text: "第一章" }] },
        { type: "paragraph", attrs: { id: "body-1" }, content: [{ type: "text", text: "正文" }] },
        { type: "heading", attrs: { id: "chapter-2", level: 2 }, content: [{ type: "text", text: "第二章" }] },
      ],
    }, "chapter-1");

    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ id: "chapter-1", title: "第一章" });
    expect(slides[0].content).toHaveLength(1);
    expect(slides[1]).toMatchObject({ id: "chapter-2", title: "第二章" });
  });

  it("rejects AI nodes outside the editor whitelist", () => {
    expect(isAllowedAIContent([{ type: "paragraph", content: [{ type: "text", text: "安全文本" }] }])).toBe(true);
    expect(isAllowedAIContent([{ type: "image", attrs: { src: "https://example.com/a.png" } }])).toBe(false);
  });
});
