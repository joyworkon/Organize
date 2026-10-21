// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Embed } from "@/components/editor/extensions/embed";
import { InlineMath, MathBlock } from "@/components/editor/extensions/math";
import { isBareHttpUrl, shouldPasteUrlAsEmbed } from "./paste-url-embed";

describe("bare HTTP URL paste", () => {
  it.each([
    [" https://example.com/a?x=1#section \n", "https://example.com/a?x=1#section"],
    ["example.com/a", "https://example.com/a"], ["http://example.com", "http://example.com"],
    ["/notes/123", null], ["mailto:a@example.com", null], ["tel:+12345", null],
    ["javascript:alert(1)", null], ["//example.com", null], ["", null],
    ["看看 https://example.com", null], ["https://example.com\nhttps://other.com", null],
    ["https://user:password@example.com", null], ["https://example.com a", null],
  ])("normalizes only one complete URL: %s", (input, expected) => expect(isBareHttpUrl(input!)).toBe(expected));

  it.each([
    { type: "paragraph", text: "", expected: true },
    { type: "paragraph", text: "   ", expected: true },
    { type: "paragraph", text: "你好世界", expected: false },
    { type: "codeBlock", text: "", expected: false },
    { type: "heading", text: "", expected: false },
  ])("guards $type with '$text'", ({ type, text, expected }) => {
    const editor = new Editor({ extensions: [StarterKit, Embed], content: { type: "doc", content: [{ type, content: text ? [{ type: "text", text }] : [] }] } });
    editor.commands.setTextSelection(1);
    const input = { clipboardText: "example.com/a", selection: editor.state.selection, isEditable: true };
    expect(shouldPasteUrlAsEmbed(input)).toBe(expected);
    expect(shouldPasteUrlAsEmbed({ ...input, isEditable: false })).toBe(false);
    expect(shouldPasteUrlAsEmbed({ ...input, clipboardText: "text example.com" })).toBe(false);
    editor.destroy();
  });

  it("rejects text/node selections, stored or whitespace inline code, inline math and required list paragraphs", () => {
    const editor = new Editor({ extensions: [StarterKit, Embed, InlineMath, MathBlock], content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] } });
    const check = () => shouldPasteUrlAsEmbed({ clipboardText: "https://example.com", isEditable: true, selection: editor.state.selection, storedMarks: editor.state.storedMarks });
    editor.commands.setTextSelection({ from: 1, to: 2 }); expect(check()).toBe(false);
    editor.commands.setTextSelection(1); editor.commands.setMark("code"); expect(check()).toBe(false);
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " ", marks: [{ type: "code" }] }] }] }); editor.commands.setTextSelection(1); expect(check()).toBe(false);
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "" } }] }] });
    editor.commands.setTextSelection(1); expect(check()).toBe(false);
    editor.commands.setNodeSelection(1); expect(check()).toBe(false);
    editor.destroy();
  });
  it("preserves schema-required list paragraphs", () => {
    const editor = new Editor({ extensions: [StarterKit, Embed], content: { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] } });
    editor.commands.setTextSelection(3);
    expect(shouldPasteUrlAsEmbed({ clipboardText: "example.com", selection: editor.state.selection, isEditable: true })).toBe(false);
    editor.destroy();
  });
});
