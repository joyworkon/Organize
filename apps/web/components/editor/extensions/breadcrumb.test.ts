// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Breadcrumb } from "./breadcrumb";

describe("Breadcrumb 节点持久化", () => {
  it("插入并解析路径栏块", () => {
    const editor = new Editor({
      extensions: [StarterKit, Breadcrumb],
      content: { type: "doc", content: [{ type: "breadcrumb" }] },
    });
    const html = editor.getHTML();
    expect(html).toContain("data-breadcrumb");
    const parsed = new Editor({
      extensions: [StarterKit, Breadcrumb],
      content: html,
    });
    expect(parsed.getJSON().content?.[0]?.type).toBe("breadcrumb");
    editor.destroy();
    parsed.destroy();
  });

  it("insertBreadcrumb 命令插入路径栏块", () => {
    const editor = new Editor({
      extensions: [StarterKit, Breadcrumb],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.insertBreadcrumb();
    expect(editor.getJSON().content?.some((n) => n.type === "breadcrumb")).toBe(true);
    editor.destroy();
  });
});
