// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Tabs, Tab } from "./tabs-node";

describe("Tabs 节点持久化", () => {
  it("渲染并解析 tabs/tab 结构与 activeIndex", () => {
    const editor = new Editor({
      extensions: [StarterKit, Tabs, Tab],
      content: {
        type: "doc",
        content: [
          {
            type: "tabs",
            attrs: { activeIndex: 1 },
            content: [
              { type: "tab", attrs: { title: "A", active: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "内容A" }] }] },
              { type: "tab", attrs: { title: "B", active: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "内容B" }] }] },
            ],
          },
        ],
      },
    });
    const html = editor.getHTML();
    expect(html).toContain("data-tabs");
    expect(html).toContain("data-active-index");
    expect(html).toContain('data-title="A"');
    expect(html).toContain('data-title="B"');
    const parsed = new Editor({ extensions: [StarterKit, Tabs, Tab], content: html });
    const doc = parsed.getJSON();
    const tabs = doc.content?.[0];
    expect(tabs?.type).toBe("tabs");
    expect(tabs?.attrs?.activeIndex).toBe(1);
    expect(tabs?.content?.length).toBe(2);
    expect(tabs?.content?.[1]?.attrs?.title).toBe("B");
    editor.destroy();
    parsed.destroy();
  });

  it("insertTabs 命令插入两个标签页", () => {
    const editor = new Editor({
      extensions: [StarterKit, Tabs, Tab],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.insertTabs();
    const json = editor.getJSON();
    const tabs = json.content?.find((n) => n.type === "tabs");
    expect(tabs).toBeTruthy();
    expect(tabs?.content?.length).toBe(2);
    editor.destroy();
  });
});
