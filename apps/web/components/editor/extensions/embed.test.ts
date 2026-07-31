// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Embed } from "./embed";

describe("Embed 节点持久化", () => {
  it("渲染并解析 url/title 等属性", () => {
    const attrs = {
      url: "https://example.com/post",
      title: "示例文章",
      provider: "",
      siteName: "example.com",
    };
    const editor = new Editor({
      extensions: [StarterKit, Embed],
      content: { type: "doc", content: [{ type: "embed", attrs }] },
    });
    const html = editor.getHTML();
    expect(html).toContain("data-embed");
    expect(html).toContain('data-url="https://example.com/post"');
    expect(html).toContain('data-title="示例文章"');
    const parsed = new Editor({ extensions: [StarterKit, Embed], content: html });
    const json = parsed.getJSON().content?.[0]?.attrs;
    expect(json?.url).toBe("https://example.com/post");
    expect(json?.title).toBe("示例文章");
    editor.destroy();
    parsed.destroy();
  });

  it("insertEmbed 命令插入嵌入块", () => {
    const editor = new Editor({
      extensions: [StarterKit, Embed],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.insertEmbed("https://example.com");
    const json = editor.getJSON();
    const embed = json.content?.find((n) => n.type === "embed");
    expect(embed).toBeTruthy();
    expect(embed?.attrs?.url).toBe("https://example.com");
    editor.destroy();
  });
});
