// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Mermaid } from "./mermaid-node";

describe("Mermaid 节点持久化", () => {
  it("渲染并解析 code 属性（URL 编码存储）", () => {
    const code = "graph TD\nA-->B";
    const editor = new Editor({
      extensions: [StarterKit, Mermaid],
      content: { type: "doc", content: [{ type: "mermaid", attrs: { code } }] },
    });
    const html = editor.getHTML();
    expect(html).toContain("data-mermaid");
    expect(html).toContain("data-code");
    const parsed = new Editor({ extensions: [StarterKit, Mermaid], content: html });
    expect(parsed.getJSON().content?.[0]?.attrs?.code).toBe(code);
    editor.destroy();
    parsed.destroy();
  });

  it("insertMermaid 命令插入图表块", () => {
    const editor = new Editor({
      extensions: [StarterKit, Mermaid],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.insertMermaid();
    expect(editor.getJSON().content?.some((n) => n.type === "mermaid")).toBe(true);
    editor.destroy();
  });
});
