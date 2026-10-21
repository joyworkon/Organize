// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractLinksFromContent, internalLinkKeyFromHref } from "@/lib/note-links";
import { BLOCK_COMMANDS, executeNestedCommand } from "../block-commands";
import { PageLinkTrigger, insertPageLink, type PageLinkEvent } from "./page-link-trigger";

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
