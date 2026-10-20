// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { SlashCommand, type SlashMenuEventDetail } from "./slash-command";

/** suggestion 的 onStart/onUpdate 在 `await items()` 之后触发（microtask），onExit 同步 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let editor: Editor | null = null;
let element: HTMLElement | null = null;
let events: SlashMenuEventDetail[] = [];
let cleanups: Array<() => void> = [];

function createEditor() {
  element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: [StarterKit, SlashCommand],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  events = [];
  editor.view.dom.addEventListener("organize-editor-action", (event) => {
    events.push((event as CustomEvent<SlashMenuEventDetail>).detail);
  });
  return editor;
}

function keydown(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  editor!.view.dom.dispatchEvent(event);
  return event;
}

/** 模拟挂载中的行内菜单：消费 slash-menu-key 询问 */
function mountMenuConsumer() {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<SlashMenuEventDetail>).detail;
    if (detail?.type === "slash-menu-key") event.preventDefault();
  };
  document.addEventListener("organize-editor-action", handler);
  cleanups.push(() => document.removeEventListener("organize-editor-action", handler));
}

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  editor?.destroy();
  editor = null;
  element?.remove();
  element = null;
});

describe("SlashCommand 扩展：行内筛选事件合同", () => {
  it("'/' opens with the block position, then each typed character updates query and range", async () => {
    const editor = createEditor();
    editor.commands.insertContent("/");
    await flush();
    expect(events).toEqual([
      expect.objectContaining({ type: "slash-menu", pos: 0, range: { from: 1, to: 2 }, query: "", nested: false }),
    ]);
    expect((events[0] as Extract<SlashMenuEventDetail, { type: "slash-menu" }>).point).toEqual(
      expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) })
    );

    editor.commands.insertContent("h2");
    await flush();
    expect(events[1]).toEqual(expect.objectContaining({ type: "slash-menu-update", query: "h2", range: { from: 1, to: 4 } }));
    expect(editor.getText()).toBe("/h2");
  });

  it("typing '/' before existing text filters by what follows the slash up to the caret only", async () => {
    const editor = createEditor();
    editor.commands.insertContent("已有文字");
    editor.commands.setTextSelection(1);
    editor.commands.insertContent("/");
    await flush();
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "slash-menu", range: { from: 1, to: 2 }, query: "" }));
    editor.commands.insertContent("h");
    await flush();
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "slash-menu-update", query: "h", range: { from: 1, to: 3 } }));
    expect(editor.getText()).toBe("/h已有文字");
  });

  it("exits when the slash is deleted, a space is typed or the caret leaves the trigger", async () => {
    const editor = createEditor();
    editor.commands.insertContent("/h");
    await flush();
    editor.commands.deleteRange({ from: 1, to: 3 });
    expect(events.at(-1)).toEqual({ type: "slash-menu-exit" });

    editor.commands.insertContent("/h");
    await flush();
    editor.commands.insertContent(" ");
    expect(events.at(-1)).toEqual({ type: "slash-menu-exit" });

    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    editor.commands.insertContent("/h");
    await flush();
    editor.commands.setTextSelection(1);
    expect(events.at(-1)).toEqual({ type: "slash-menu-exit" });
  });

  it("asks the mounted menu about ↑/↓/Enter/Tab and swallows the editor default only when the menu consumes", async () => {
    const editor = createEditor();
    editor.commands.insertContent("/h");
    await flush();
    mountMenuConsumer();
    for (const key of ["ArrowDown", "ArrowUp", "Tab", "Enter"]) {
      const event = keydown(key);
      expect(event.defaultPrevented, key).toBe(true);
      expect(events.at(-1), key).toEqual({ type: "slash-menu-key", key });
    }
    // Enter 被菜单消费：段落没有被拆开，触发文本原样保留
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.getText()).toBe("/h");
  });

  it("lets Enter split the paragraph again once nobody (menu closed) consumes the question", async () => {
    const editor = createEditor();
    editor.commands.insertContent("/h");
    await flush();
    const before = events.length;
    const event = keydown("Enter");
    expect(events.slice(before).filter((entry) => entry.type === "slash-menu-key")).toEqual([{ type: "slash-menu-key", key: "Enter" }]);
    // 核心 keymap 照常分段（它自己 preventDefault），触发文本留在原段落
    expect(event.defaultPrevented).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.textContent).toBe("/h");
    // 光标移到了新段落，suggestion 同步失活
    expect(events.at(-1)).toEqual({ type: "slash-menu-exit" });
    await flush();
    expect(events.filter((entry) => entry.type === "slash-menu-exit")).toHaveLength(1);
  });

  it("never asks the menu for other keys, while an IME composition is active, or when inactive", async () => {
    const editor = createEditor();
    editor.commands.insertContent("/h");
    await flush();
    mountMenuConsumer();
    const before = events.length;
    keydown("a");
    keydown("Escape");
    keydown("Enter", { isComposing: true });
    keydown("Enter", { keyCode: 229 } as KeyboardEventInit);
    expect(events.slice(before).filter((entry) => entry.type === "slash-menu-key")).toEqual([]);

    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] });
    editor.commands.setTextSelection(6);
    const idle = events.length;
    keydown("Enter");
    expect(events.slice(idle).filter((entry) => entry.type === "slash-menu-key")).toEqual([]);
  });

  it("reports nested=true inside list items and keeps the nearest block position", async () => {
    const editor = createEditor();
    editor.commands.setContent({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }],
    });
    editor.commands.setTextSelection(3);
    editor.commands.insertContent("/");
    await flush();
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "slash-menu", nested: true, pos: 2, range: { from: 3, to: 4 } }));
  });
});
