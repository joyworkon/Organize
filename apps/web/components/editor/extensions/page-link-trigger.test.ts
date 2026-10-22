// @vitest-environment jsdom
import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractLinksFromContent, internalLinkKeyFromHref } from "@/lib/note-links";
import { BLOCK_COMMANDS, executeNestedCommand } from "../block-commands";
import { PageLinkTrigger, insertPageLink, pageLinkPluginKey, type PageLinkEvent } from "./page-link-trigger";

const editors: Editor[] = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(content = "<p></p>", editable = true) {
  const editor = new Editor({ extensions: [StarterKit, Link, PageLinkTrigger], content, editable });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 30, right: 30, top: 40, bottom: 60 });
  const events: PageLinkEvent[] = [];
  editor.view.dom.addEventListener("organize-page-link", (event) => events.push((event as CustomEvent<PageLinkEvent>).detail));
  editors.push(editor);
  return { editor, events };
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe("inline page links", () => {
  it.each(["<p>已有</p>", "<h2>已有</h2>", "<ul><li><p>已有</p></li></ul>"])("opens mid-text in %s and searches through spaces", async (content) => {
    const { editor, events } = setup(content);
    editor.commands.setTextSelection(content.startsWith("<ul>") ? 5 : 3);
    editor.commands.insertContent("[[会议 A");
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "start", query: "会议 A", point: { left: 30, top: 68 } });
    editor.commands.insertContent("B");
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "update", query: "会议 AB" });
    editor.commands.setTextSelection(1);
    await flush();
    expect(events.at(-1)).toEqual({ type: "exit" });
    expect(editor.getText()).toContain("[[会议 AB");
  });

  it.each(["<pre><code></code></pre>", "<p><code>code</code></p>"])("does not open in code: %s", async (content) => {
    const { editor, events } = setup(content);
    editor.commands.setTextSelection(content.includes("<pre>") ? 1 : 3);
    editor.commands.insertContent("[[会议");
    await flush();
    expect(events).toEqual([]);
  });
  it("does not open readonly, with a nonempty selection, or after a closing bracket", async () => {
    const { editor, events } = setup("<p></p>", false);
    editor.commands.insertContent("[[会议");
    await flush();
    expect(events).toEqual([]);
    editor.setEditable(true);
    editor.commands.setTextSelection({ from: 1, to: 3 });
    await flush();
    expect(events).toEqual([]);
    editor.commands.setTextSelection(5);
    await flush();
    events.length = 0;
    editor.commands.insertContent("]]");
    await flush();
    expect(events.filter((event) => event.type === "start")).toHaveLength(0);
  });

  it("inserts only the trigger range, with a recognized link and an unlinked caret", async () => {
    const { editor, events } = setup("<p>前文后文</p>");
    editor.commands.setTextSelection(3);
    editor.commands.insertContent("[[会议");
    await flush();
    const start = events.at(-1) as Extract<PageLinkEvent, { type: "start" | "update" }>;
    expect(insertPageLink(editor, start.range, { id: "target", title: "会议纪要" })).toBe(true);
    expect(editor.getText()).toBe("前文会议纪要后文");
    expect(editor.state.selection.from).toBe(7);
    expect(extractLinksFromContent(editor.getJSON())).toEqual([{ type: "note", url: "target" }]);
    expect(internalLinkKeyFromHref("/notes/target")).toBe("note:target");
    editor.commands.insertContent("继续");
    const text = editor.getJSON().content![0].content!;
    expect(text.find((node) => node.text?.includes("继续"))?.marks).toBeUndefined();
  });

  it("rejects stale insertion after the selection moves or permissions change", async () => {
    const { editor } = setup();
    editor.commands.insertContent("[[x");
    await flush();
    editor.commands.setTextSelection(1);
    expect(insertPageLink(editor, { from: 1, to: 4 }, { id: "t", title: "T" })).toBe(false);
    editor.commands.setTextSelection(4);
    editor.setEditable(false);
    expect(insertPageLink(editor, { from: 1, to: 4 }, { id: "t", title: "T" })).toBe(false);
  });

  it("forwards navigation keys but leaves IME keys alone", async () => {
    const { editor, events } = setup();
    editor.commands.insertContent("[[x");
    await flush();
    editor.view.dom.addEventListener("organize-page-link", (event) => {
      if ((event as CustomEvent<PageLinkEvent>).detail.type === "key") event.preventDefault();
    });
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    const before = events.length;
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }));
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }));
    expect(events.slice(before).filter((event) => event.type === "key")).toEqual([]);
  });

  it("slash commands open the same picker in top-level and nested paragraphs", async () => {
    const { editor, events } = setup();
    BLOCK_COMMANDS.find((command) => command.id === "page-link")!.run(editor, 0);
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "start", query: "" });
    editor.commands.setContent("<ul><li><p>/链接</p></li></ul>");
    editor.commands.setTextSelection(6);
    executeNestedCommand(editor, "page-link", { from: 3, to: 6 });
    await flush();
    expect(editor.state.doc.textContent).toBe("[[");
    expect(editor.getJSON().content?.[0].type).toBe("bulletList");
    expect(events.at(-1)).toMatchObject({ type: "start", query: "" });
  });
});

describe("@ page link entry", () => {
  it.each(["", "前文 ", "前文\t", "前文\u3000"])("opens after legal prefix %j with the same event and precise range", async (prefix) => {
    const { editor, events } = setup();
    editor.commands.insertContent(`${prefix}@`);
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "start", query: "", range: { from: prefix.length + 1, to: prefix.length + 2 } });
    editor.commands.insertContent("会议 A");
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "update", query: "会议 A" });
  });

  it.each(["name@", "word@会议", "中文@会议", "(@会议", "@@会议"])("does not open inside a word or email: %s", async (text) => {
    const { editor, events } = setup();
    editor.commands.insertContent(text);
    await flush();
    expect(events).toEqual([]);
  });

  it.each(["<h2></h2>", "<ul><li><p></p></li></ul>"])("opens in editable headings and nested paragraphs: %s", async (content) => {
    const { editor, events } = setup(content);
    editor.commands.setTextSelection(content.startsWith("<ul>") ? 3 : 1);
    editor.commands.insertContent("@会议");
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "start", query: "会议" });
  });

  it.each(["<pre><code></code></pre>", "<p><code>code</code></p>"])("does not open in code: %s", async (content) => {
    const { editor, events } = setup(content);
    editor.commands.setTextSelection(content.includes("<pre>") ? 1 : 3);
    editor.commands.insertContent(" @会议");
    await flush();
    expect(events).toEqual([]);
  });

  it("does not open readonly or with a nonempty selection", async () => {
    const { editor, events } = setup("<p></p>", false);
    editor.commands.insertContent("@会议");
    await flush();
    expect(events).toEqual([]);
    editor.setEditable(true);
    editor.commands.setTextSelection({ from: 1, to: 4 });
    await flush();
    expect(events).toEqual([]);
  });

  it("does not open in a formula textblock", async () => {
    const formula = Node.create({ name: "mathBlock", group: "block", content: "text*", code: true,
      parseHTML: () => [{ tag: "math" }], renderHTML: () => ["math", 0] });
    const editor = new Editor({ extensions: [StarterKit, formula, PageLinkTrigger], content: "<math></math>" });
    editors.push(editor);
    editor.commands.insertContent("@会议");
    await flush();
    expect(pageLinkPluginKey.getState(editor.state).active).toBe(false);
  });

  it("keeps @ inside [[ queries and switches triggers without mixing their ranges", async () => {
    const { editor, events } = setup();
    editor.commands.insertContent("[[会议 @页面");
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "start", query: "会议 @页面", range: { from: 1, to: 9 } });
    editor.commands.insertContent("]] @其它");
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "start", query: "其它", range: { from: 12, to: 15 } });
    expect(insertPageLink(editor, { from: 12, to: 15 }, { id: "target", title: "其它页面" })).toBe(true);
    expect(editor.getText()).toBe("[[会议 @页面]] 其它页面");
  });

  it.each(["[[", "@"])("inserts %s in one undoable operation and leaves subsequent text unlinked", async (trigger) => {
    const { editor, events } = setup("<p>前文 后文</p>");
    editor.commands.setTextSelection(4);
    editor.commands.insertContent(`${trigger}会议`);
    await flush();
    const start = events.at(-1) as Extract<PageLinkEvent, { type: "start" | "update" }>;
    expect(insertPageLink(editor, start.range, { id: "target", title: "会议纪要" })).toBe(true);
    expect(editor.getText()).toBe("前文 会议纪要后文");
    expect(extractLinksFromContent(editor.getJSON())).toEqual([{ type: "note", url: "target" }]);
    editor.commands.insertContent("继续");
    expect(editor.getJSON().content![0].content!.find((node) => node.text?.includes("继续"))?.marks).toBeUndefined();
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe(`前文 ${trigger}会议后文`);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getHTML()).toContain('href="/notes/target"');
  });

  it.each([{ from: -1, to: 4 }, { from: 1, to: 999 }, { from: 1.5, to: 4 }, { from: 4, to: 1 }, { from: 1, to: NaN }])("rejects invalid range %j without throwing", (range) => {
    const { editor } = setup("<p>@会议</p>");
    expect(insertPageLink(editor, range, { id: "t", title: "T" })).toBe(false);
  });

  it("rejects a stale @ range, readonly and destroyed editors", async () => {
    const { editor } = setup();
    editor.commands.insertContent("@会议");
    await flush();
    expect(insertPageLink(editor, { from: 2, to: 4 }, { id: "t", title: "T" })).toBe(false);
    editor.setEditable(false);
    expect(insertPageLink(editor, { from: 1, to: 4 }, { id: "t", title: "T" })).toBe(false);
    editor.destroy();
    expect(insertPageLink(editor, { from: 1, to: 4 }, { id: "t", title: "T" })).toBe(false);
  });
});
