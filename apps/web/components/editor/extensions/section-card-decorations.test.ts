// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { SectionCardDecorations } from "./section-card-decorations";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("SectionCardDecorations", () => {
  it("groups leading content and each top-level H1 into visual cards", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit, SectionCardDecorations],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "开篇" }] },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "第一章" }] },
          { type: "paragraph", content: [{ type: "text", text: "正文" }] },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "第二章" }] },
        ],
      },
    });

    const blocks = Array.from(element.querySelectorAll<HTMLElement>(".organize-section-card"));
    expect(blocks).toHaveLength(4);
    expect(blocks.map((block) => block.dataset.sectionIndex)).toEqual(["0", "1", "1", "2"]);
    expect(blocks[0].classList.contains("organize-section-card-first")).toBe(true);
    expect(blocks[0].classList.contains("organize-section-card-last")).toBe(true);
    expect(blocks[1].classList.contains("organize-section-card-first")).toBe(true);
    expect(blocks[2].classList.contains("organize-section-card-last")).toBe(true);
    expect(element.querySelectorAll(".organize-section-heading-label")).toHaveLength(2);
    expect(editor.getJSON().content).toHaveLength(4);
  });

  it("does not let nested headings split a top-level card", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit, SectionCardDecorations],
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "章节" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "子标题" }] },
          { type: "paragraph", content: [{ type: "text", text: "正文" }] },
        ],
      },
    });

    const blocks = Array.from(element.querySelectorAll<HTMLElement>(".organize-section-card"));
    expect(blocks.map((block) => block.dataset.sectionIndex)).toEqual(["0", "0", "0"]);
  });
});
