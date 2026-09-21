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
      extensions: [StarterKit, SectionCardDecorations.configure({ enabled: () => true })],
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
    expect(editor.getJSON().content?.[1].attrs?.sectionLabel).toBe("Title");
    expect(editor.getJSON().content?.[3].attrs?.sectionLabel).toBe("Title");
    expect(editor.getJSON().content).toHaveLength(4);
  });

  it("does not let nested headings split a top-level card", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit, SectionCardDecorations.configure({ enabled: () => true })],
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


describe("template editing and persistence", () => {
  it("keeps default notes undecorated and preserves saved card boundaries", () => {
    editor = new Editor({ extensions: [StarterKit, SectionCardDecorations], content: {
      type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Original" }] }],
    } });
    expect(editor.view.dom.querySelector(".organize-section-heading-label")).toBeNull();
    expect(editor.getText()).toBe("Original");
  });

  it("splits a card without a heading; Enter does not propagate the split", () => {
    editor = new Editor({ extensions: [StarterKit, SectionCardDecorations.configure({ enabled: () => true })], content: {
      type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", attrs: { sectionStart: true }, content: [{ type: "text", text: "two" }] },
      ],
    } });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.splitBlock();
    const blocks = Array.from(editor.view.dom.querySelectorAll<HTMLElement>(".organize-section-card"));
    expect(blocks.map((block) => block.dataset.sectionIndex)).toEqual(["0", "1", "1"]);
    const json = editor.getJSON();
    expect(json.content?.[1].attrs?.sectionStart).toBe(true);
    expect(json.content?.[2].attrs?.sectionStart).toBe(false);
    editor.commands.setContent(json);
    expect(editor.view.dom.querySelectorAll(".organize-section-card-first")).toHaveLength(2);
    editor.commands.undo();
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("edits an empty heading and persists its English label as metadata", () => {
    editor = new Editor({ extensions: [StarterKit, SectionCardDecorations.configure({ enabled: () => true })], content: {
      type: "doc", content: [{ type: "heading", attrs: { level: 1 } }],
    } });
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("可编辑标题");
    const heading = editor.state.doc.child(0);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, {
      ...heading.attrs,
      sectionLabel: "Overview",
    }));
    expect(editor.getJSON().content?.[0].attrs?.sectionLabel).toBe("Overview");
    expect(editor.getText()).toBe("可编辑标题");
    editor.commands.setContent(editor.getJSON());
    expect(editor.state.doc.child(0).attrs.sectionLabel).toBe("Overview");
  });
});
