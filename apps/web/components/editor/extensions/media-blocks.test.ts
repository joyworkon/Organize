// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { FileAttachment } from "./file-attachment";
import Image from "@tiptap/extension-image";
import { ResizableImage } from "./resizable-image";

describe("ResizableImage / FileAttachment 属性持久化", () => {
  it("图片宽度属性渲染并解析", () => {
    const editor = new Editor({
      extensions: [StarterKit, ResizableImage],
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "https://example.com/a.png", width: 320 },
          },
        ],
      },
    });
    const html = editor.getHTML();
    expect(html).toContain('data-width="320"');
    const parsed = new Editor({
      extensions: [StarterKit, ResizableImage],
      content: html,
    });
    expect(parsed.getJSON().content?.[0]?.attrs?.width).toBe(320);
    editor.destroy();
    parsed.destroy();
  });

  it("legacy images keep exact getJSON/getHTML output (no default align)", () => {
    const LegacyImage = Image.extend({
      addAttributes() {
        return { ...this.parent?.(), width: { default: null,
          parseHTML: (element: HTMLElement) => { const value = Number.parseFloat(element.getAttribute("data-width") ?? element.style.width); return Number.isFinite(value) && value > 0 ? Math.round(value) : null; },
          renderHTML: (attrs: Record<string, unknown>) => attrs.width ? { "data-width": String(attrs.width), style: `width: ${attrs.width}px` } : {},
        } };
      },
    });
    for (const width of [null, 320]) {
      const content = { type: "doc", content: [{ type: "image", attrs: { src: "https://example.com/a.png", alt: "old alt", title: "old title", width } }] };
      const before = new Editor({ extensions: [StarterKit, LegacyImage], content });
      const after = new Editor({ extensions: [StarterKit, ResizableImage], content });
      expect(after.getJSON()).toEqual(before.getJSON());
      expect(after.getHTML()).toBe(before.getHTML());
      const parsed = new Editor({ extensions: [StarterKit, ResizableImage], content: before.getHTML() });
      expect(parsed.getJSON()).toEqual(before.getJSON());
      expect(parsed.getHTML()).toBe(before.getHTML());
      before.destroy(); after.destroy(); parsed.destroy();
    }
  });

  it("附件块属性渲染并解析", () => {
    const attrs = {
      src: "https://example.com/f.pdf",
      name: "f.pdf",
      size: 1024,
      mime: "application/pdf",
    };
    const editor = new Editor({
      extensions: [StarterKit, FileAttachment],
      content: { type: "doc", content: [{ type: "fileAttachment", attrs }] },
    });
    const html = editor.getHTML();
    expect(html).toContain("data-file-attachment");
    expect(html).toContain('href="https://example.com/f.pdf"');
    const parsed = new Editor({
      extensions: [StarterKit, FileAttachment],
      content: html,
    });
    const json = parsed.getJSON().content?.[0]?.attrs;
    expect(json?.src).toBe(attrs.src);
    expect(json?.name).toBe("f.pdf");
    expect(json?.mime).toBe("application/pdf");
    editor.destroy();
    parsed.destroy();
  });
});
