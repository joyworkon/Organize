// @vitest-environment jsdom
import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmojiSuggestTrigger,
  emojiSuggestPluginKey,
  findEmojiShortcodeClose,
  findEmojiTriggerMatch,
  insertEmoji,
  type EmojiSuggestEvent,
} from "./emoji-trigger";

const editors: Editor[] = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup(content = "<p></p>", editable = true) {
  const editor = new Editor({ extensions: [StarterKit, EmojiSuggestTrigger], content, editable });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 30, right: 30, top: 40, bottom: 60 });
  const events: EmojiSuggestEvent[] = [];
  editor.view.dom.addEventListener("organize-emoji-suggest", (event) => events.push((event as CustomEvent<EmojiSuggestEvent>).detail));
  editors.push(editor);
  return { editor, events };
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe("findEmojiTriggerMatch（触发判定纯函数）", () => {
  it.each([
    [":fire", "fire"],
    ["前文 :fire", "fire"],
    ["前文　:火", "火"],
    ["(:fire", "fire"],
    ["。:fire", "fire"],
    ["…:ab", "ab"],
  ])("matches after start/whitespace/punctuation: %j", (before, query) => {
    expect(findEmojiTriggerMatch(before)).toEqual({ text: `:${query}`, query });
  });

  it.each([
    [":"],
    [": fire"],
    [":fire "],
    ["12:30"],
    ["http://example.com"],
    ["a:b"],
    ["word:fire"],
    ["：火"],
    [":abc:def"],
    ["plain text"],
  ])("does not match: %j", (before) => {
    expect(findEmojiTriggerMatch(before)).toBeNull();
  });

  it("caps the query at 20 characters", () => {
    expect(findEmojiTriggerMatch(`:${"a".repeat(20)}`)?.query).toBe("a".repeat(20));
    expect(findEmojiTriggerMatch(`:${"a".repeat(21)}`)).toBeNull();
  });
});

describe("findEmojiShortcodeClose（收尾冒号纯函数）", () => {
  it.each([
    [":fire:", 6, "fire"],
    ["前文 :火:", 3, "火"],
    ["(:fire:", 6, "fire"],
  ])("matches a closed shortcode: %j", (text, length, query) => {
    expect(findEmojiShortcodeClose(text)).toEqual({ length, query });
  });

  it.each([
    [":fire"],
    ["12:30:"],
    ["a:fire:"],
    [":fire:x"],
    ["::"],
    [":fire::"],
  ])("does not match: %j", (text) => {
    expect(findEmojiShortcodeClose(text)).toBeNull();
  });
});

describe("emoji suggest trigger（编辑器集成）", () => {
  it.each(["<p>已有</p>", "<h2>已有</h2>", "<ul><li><p>已有</p></li></ul>"])("opens after whitespace in %s and updates the query", async (content) => {
    const { editor, events } = setup(content);
    editor.commands.setTextSelection(content.startsWith("<ul>") ? 5 : 3);
    editor.commands.insertContent(" :fire");
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "start", query: "fire", point: { left: 30, top: 68, anchorTop: 40 } });
    editor.commands.insertContent("x");
    await flush();
    expect(events.at(-1)).toMatchObject({ type: "update", query: "firex" });
    editor.commands.setTextSelection(1);
    await flush();
    expect(events.at(-1)).toEqual({ type: "exit" });
    expect(editor.getText()).toContain(":firex");
  });

  it.each(["12:30", "http://example.com", ": 火", "a:fire"])("does not open for: %s", async (text) => {
    const { editor, events } = setup();
    editor.commands.insertContent(text);
    await flush();
    expect(events).toEqual([]);
  });

  it("does not open for a bare colon without a query character", async () => {
    const { editor, events } = setup();
    editor.commands.insertContent(":");
    await flush();
    expect(events).toEqual([]);
  });

  it.each(["<pre><code></code></pre>", "<p><code>code</code></p>"])("does not open in code: %s", async (content) => {
    const { editor, events } = setup(content);
    editor.commands.setTextSelection(content.includes("<pre>") ? 1 : 3);
    editor.commands.insertContent(":fire");
    await flush();
    expect(events).toEqual([]);
  });

  it("does not open in a formula textblock", async () => {
    const formula = Node.create({ name: "mathBlock", group: "block", content: "text*", code: true,
      parseHTML: () => [{ tag: "math" }], renderHTML: () => ["math", 0] });
    const editor = new Editor({ extensions: [StarterKit, formula, EmojiSuggestTrigger], content: "<math></math>" });
    editors.push(editor);
    editor.commands.insertContent(":fire");
    await flush();
    expect(emojiSuggestPluginKey.getState(editor.state).active).toBe(false);
  });

  it("does not open readonly or with a nonempty selection", async () => {
    const { editor, events } = setup("<p></p>", false);
    editor.commands.insertContent(":fire");
    await flush();
    expect(events).toEqual([]);
    editor.setEditable(true);
    editor.commands.setTextSelection({ from: 1, to: 4 });
    await flush();
    expect(events).toEqual([]);
  });

  it("inserts the emoji over the trigger range and undoes back to the shortcode text", async () => {
    const { editor, events } = setup("<p>前文 后文</p>");
    editor.commands.setTextSelection(4);
    editor.commands.insertContent(":fire");
    await flush();
    const start = events.at(-1) as Extract<EmojiSuggestEvent, { type: "start" | "update" }>;
    expect(insertEmoji(editor, start.range, "🔥")).toBe(true);
    expect(editor.getText()).toBe("前文 🔥后文");
    editor.commands.insertContent("继续");
    expect(editor.getText()).toBe("前文 🔥继续后文");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("前文 :fire后文");
  });

  it.each([{ from: -1, to: 4 }, { from: 1, to: 999 }, { from: 1.5, to: 4 }, { from: 4, to: 1 }, { from: 1, to: NaN }])("rejects invalid range %j without throwing", (range) => {
    const { editor } = setup("<p>:fire</p>");
    expect(insertEmoji(editor, range, "🔥")).toBe(false);
  });

  it("rejects stale insertion after the selection moves or permissions change", async () => {
    const { editor, events } = setup();
    editor.commands.insertContent(":fire");
    await flush();
    const start = events.at(-1) as Extract<EmojiSuggestEvent, { type: "start" | "update" }>;
    editor.commands.setTextSelection(1);
    expect(insertEmoji(editor, start.range, "🔥")).toBe(false);
    editor.commands.setTextSelection(start.range.to);
    editor.setEditable(false);
    expect(insertEmoji(editor, start.range, "🔥")).toBe(false);
    expect(insertEmoji(editor, start.range, "")).toBe(false);
  });

  it("replaces a full shortcode on the closing colon and leaves unknown shortcodes literal", async () => {
    const { editor } = setup();
    editor.commands.insertContent(":fire");
    await flush();
    const handled = editor.view.someProp("handleTextInput", (fn) => fn(editor.view, 6, 6, ":", () => editor.state.tr));
    expect(handled).toBe(true);
    expect(editor.getText()).toBe("🔥");
    expect(editor.state.selection.from).toBe(3);

    editor.commands.setContent("<p></p>");
    editor.commands.insertContent(":unknown");
    await flush();
    const skipped = editor.view.someProp("handleTextInput", (fn) => fn(editor.view, 9, 9, ":", () => editor.state.tr));
    expect(skipped).toBeFalsy();
    expect(editor.getText()).toBe(":unknown");
  });

  it("does not replace a shortcode inside inline code", async () => {
    const { editor } = setup("<p><code>:fire</code></p>");
    editor.commands.setTextSelection(6);
    const handled = editor.view.someProp("handleTextInput", (fn) => fn(editor.view, 6, 6, ":", () => editor.state.tr));
    expect(handled).toBeFalsy();
    expect(editor.getText()).toBe(":fire");
  });

  it("forwards navigation keys including Tab but leaves IME keys alone", async () => {
    const { editor, events } = setup();
    editor.commands.insertContent(":f");
    await flush();
    editor.view.dom.addEventListener("organize-emoji-suggest", (event) => {
      if ((event as CustomEvent<EmojiSuggestEvent>).detail.type === "key") event.preventDefault();
    });
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    const before = events.length;
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true }));
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }));
    expect(events.slice(before).filter((event) => event.type === "key")).toEqual([]);
  });
});
