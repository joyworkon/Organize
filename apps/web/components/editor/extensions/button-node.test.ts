// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { ButtonBlock } from "./button-node";

describe("ButtonBlock 节点持久化", () => {
  it("渲染并解析 label/action/payload 属性", () => {
    const attrs = { label: "点这里", action: "open-url" as const, payload: "https://example.com" };
    const editor = new Editor({
      extensions: [StarterKit, ButtonBlock],
      content: { type: "doc", content: [{ type: "buttonBlock", attrs }] },
    });
    const html = editor.getHTML();
    expect(html).toContain("data-button-block");
    expect(html).toContain('data-label="点这里"');
    expect(html).toContain('data-action="open-url"');
    const parsed = new Editor({ extensions: [StarterKit, ButtonBlock], content: html });
    const json = parsed.getJSON().content?.[0]?.attrs;
    expect(json?.label).toBe("点这里");
    expect(json?.action).toBe("open-url");
    expect(json?.payload).toBe("https://example.com");
    editor.destroy();
    parsed.destroy();
  });

  it("insertButtonBlock 命令插入按钮块", () => {
    const editor = new Editor({
      extensions: [StarterKit, ButtonBlock],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.insertButtonBlock();
    expect(editor.getJSON().content?.some((n) => n.type === "buttonBlock")).toBe(true);
    editor.destroy();
  });
});
