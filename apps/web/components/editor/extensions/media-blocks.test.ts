// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { FileAttachment } from "./file-attachment";
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
