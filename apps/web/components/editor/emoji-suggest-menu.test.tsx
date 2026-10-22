// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRecentEmojis } from "@/lib/editor/emoji-recents";
import { EmojiSuggestTrigger } from "./extensions/emoji-trigger";
import { EmojiSuggestMenu } from "./emoji-suggest-menu";

let editor: Editor;
let root: Root;
let container: HTMLElement;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
function type(text: string) { act(() => { editor.commands.insertContent(text); }); }
function key(key: string) { act(() => { editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); }); }
function options() { return Array.from(document.querySelectorAll<HTMLButtonElement>('.emoji-suggest-popover [role="option"]')); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
  localStorage.clear();
  editor = new Editor({ extensions: [StarterKit, EmojiSuggestTrigger], content: "<p></p>" });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 10, right: 10, top: 30, bottom: 50 });
  document.body.appendChild(editor.view.dom);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<EmojiSuggestMenu editor={editor} />); });
});
afterEach(() => { act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("emoji suggest menu（浮层）", () => {
  it("lists matches with aria roles, highlights the keyword, and Enter inserts the emoji", async () => {
    type(":fire");
    await flush();
    const list = document.querySelector('[role="listbox"]');
    expect(list?.getAttribute("aria-label")).toBe("插入表情");
    expect(options()[0].textContent).toContain("🔥");
    expect(options()[0].textContent).toContain("fire");
    expect(options()[0].querySelector("mark")?.textContent).toBe("fire");
    key("Enter");
    await flush();
    expect(editor.getText()).toBe("🔥");
    expect(document.querySelector(".emoji-suggest-popover")).toBeNull();
    expect(readRecentEmojis()).toEqual(["🔥"]);
  });

  it("inserts on Tab and on mouse click without stealing focus", async () => {
    type(":rob");
    await flush();
    expect(options()[0].textContent).toContain("🤖");
    key("Tab");
    await flush();
    expect(editor.getText()).toBe("🤖");
    act(() => { editor.commands.setContent("<p></p>"); });
    type(":ro");
    await flush();
    act(() => { options().find((option) => option.textContent?.includes("🚀"))!.click(); });
    await flush();
    expect(editor.getText()).toBe("🚀");
    expect(readRecentEmojis()).toEqual(["🚀", "🤖"]);
  });

  it("moves the active option with arrow keys", async () => {
    type(":fire");
    await flush();
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    key("ArrowDown");
    await flush();
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    key("ArrowUp");
    await flush();
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("ranks a matching recent emoji first on a single-character query", async () => {
    type(":fire");
    await flush();
    key("Enter");
    await flush();
    act(() => { editor.commands.setContent("<p></p>"); });
    type(":f");
    await flush();
    expect(options()[0].textContent).toContain("🔥");
  });

  it("Escape preserves typed text and stays closed while typing", async () => {
    type(":fire");
    await flush();
    key("Escape");
    expect(document.querySelector(".emoji-suggest-popover")).toBeNull();
    type("x");
    await flush();
    expect(document.querySelector(".emoji-suggest-popover")).toBeNull();
    expect(editor.getText()).toBe(":firex");
  });

  it("shows nothing when no emoji matches, and closes on editor blur", async () => {
    type(":zzzzzz");
    await flush();
    expect(document.querySelector(".emoji-suggest-popover")).toBeNull();
    expect(editor.getText()).toBe(":zzzzzz");
    act(() => { editor.commands.setContent("<p></p>"); });
    type(":fire");
    await flush();
    expect(document.querySelector(".emoji-suggest-popover")).not.toBeNull();
    act(() => { editor.emit("blur", { editor, event: new FocusEvent("blur"), transaction: editor.state.tr }); });
    await flush();
    expect(document.querySelector(".emoji-suggest-popover")).toBeNull();
    expect(editor.getText()).toBe(":fire");
  });

  it("closes when the editor becomes readonly and reports open state", async () => {
    let open = false;
    act(() => { root.render(<EmojiSuggestMenu editor={editor} onOpenChange={(value) => { open = value; }} />); });
    type(":fire");
    await flush();
    expect(open).toBe(true);
    act(() => { editor.setEditable(false); });
    await flush();
    expect(document.querySelector(".emoji-suggest-popover")).toBeNull();
    expect(open).toBe(false);
  });
});
