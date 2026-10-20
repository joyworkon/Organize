// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalLinkStateRow } from "@/lib/note-links";
import { LinkHoverCard } from "./link-hover-card";

describe("link card and inline editor with real TipTap transactions", () => {
  let editor: Editor, root: Root, host: HTMLDivElement, editRequest: number;
  let states: Record<string, InternalLinkStateRow>;
  const navigate = vi.fn(), copy = vi.fn().mockResolvedValue(undefined);
  function render() { root.render(<LinkHoverCard editor={editor} editRequest={editRequest} internalLinkStates={states} onNavigate={navigate} />); }
  function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label);
    if (!found) throw new Error(`Missing button ${label}`); return found;
  }
  function click(label: string) { act(() => button(label).click()); }
  function hover() {
    act(() => editor.view.dom.querySelector("a")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(300));
  }
  function request() { act(() => { editRequest++; render(); }); }
  function draft(value: string) {
    const input = document.querySelector("input")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  function submit() { act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
  function escape() { act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); }
  function href() { return editor.state.doc.firstChild?.firstChild?.marks.find((mark) => mark.type.name === "link")?.attrs.href; }
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers(); vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 330, height: 100, top: 200, bottom: 300, left: 20, right: 350, x: 20, y: 200, toJSON() {} });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    editor = new Editor({ extensions: [StarterKit, Link.configure({ openOnClick: false, defaultProtocol: "https" })], editorProps: { handleScrollToSelection: () => true }, content: '<p><a href="https://example.com">linked <strong>words</strong></a> outside</p>' });
    document.body.appendChild(editor.view.dom);
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 200, bottom: 220, left: 20, right: 30 });
    editRequest = 0; states = {}; act(render);
  });
  afterEach(() => { act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ""; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("waits 300ms, preserves selection/focus and survives crossing into the card", () => {
    const before = editor.state.selection.toJSON(), focus = document.activeElement;
    act(() => editor.view.dom.querySelector("a")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(299)); expect(document.querySelector('[aria-label="链接卡片"]')).toBeNull();
    act(() => vi.advanceTimersByTime(1)); expect(document.querySelector('[aria-label="链接卡片"]')).not.toBeNull();
    expect(editor.state.selection.toJSON()).toEqual(before); expect(document.activeElement).toBe(focus);
    const panel = document.querySelector('[aria-label="链接卡片"]')!;
    act(() => editor.view.dom.querySelector("a")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: panel })));
    act(() => vi.advanceTimersByTime(500)); expect(document.querySelector('[aria-label="链接卡片"]')).not.toBeNull();
  });
  it("opens when a collapsed caret enters and closes for nonempty selection", () => {
    act(() => { editor.view.focus(); editor.commands.setTextSelection(3); });
    expect(document.querySelector('[aria-label="链接卡片"]')).not.toBeNull();
    act(() => { editor.commands.setTextSelection({ from: 2, to: 5 }); });
    expect(document.querySelector('[aria-label="链接卡片"]')).toBeNull();
  });
  it("copies, opens safely, and removes the whole link across formatting without changing text", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null), text = editor.getText();
    hover(); await act(async () => button("复制链接").click()); expect(copy).toHaveBeenCalledWith("https://example.com");
    click("打开"); expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    hover(); click("取消链接"); expect(editor.getText()).toBe(text); expect(editor.view.dom.querySelectorAll("a")).toHaveLength(0);
    act(() => { editor.commands.undo(); }); expect(href()).toBe("https://example.com");
  });
  it("edits inline, validates, normalizes and preserves text", () => {
    hover(); click("编辑"); expect(document.querySelector<HTMLInputElement>("input")?.value).toBe("https://example.com");
    expect(document.activeElement).toBe(document.querySelector("input"));
    draft("javascript:alert(1)"); submit(); expect(document.querySelector('[role="alert"]')).not.toBeNull(); expect(href()).toBe("https://example.com");
    draft("example.org/new"); submit(); expect(href()).toBe("https://example.org/new"); expect(editor.getText()).toBe("linked words outside");
  });
  it("toolbar request captures a nonempty selection; Escape cancels and removal is explicit", () => {
    act(() => { editor.commands.setTextSelection({ from: 14, to: 19 }); });
    request(); draft("example.org"); escape(); expect(editor.view.dom.querySelectorAll("a")).toHaveLength(1);
    request(); draft("example.org"); submit(); expect(editor.view.dom.querySelectorAll("a")).toHaveLength(2);
    act(() => { editor.commands.setTextSelection(15); }); request(); click("移除链接"); expect(editor.view.dom.querySelectorAll("a")).toHaveLength(1);
  });
  it("readonly click and hover expose only open/copy; revocation closes an active editor", () => {
    hover(); click("编辑"); act(() => editor.setEditable(false)); expect(document.querySelector("input")).toBeNull();
    act(() => editor.view.dom.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect([...document.querySelectorAll("button")].map((node) => node.textContent)).toEqual(["打开", "复制链接"]);
    request(); expect(document.querySelector("input")).toBeNull();
  });
  it("uses existing internal titles/state and routes internal links without a window", () => {
    act(() => { editor.commands.setContent('<p><a href="/notes/target">internal</a></p>'); states = { "note:target": { resource_id: "target", resource_type: "note", title: "目标标题", state: "active" } }; render(); });
    hover(); expect(document.body.textContent).toContain("目标标题"); click("打开"); expect(navigate).toHaveBeenCalledWith("/notes/target");
    act(() => { states = { "note:target": { ...states["note:target"], state: "missing" } }; render(); });
    hover(); expect(document.body.textContent).toContain("链接目标不可用"); expect(button("打开").disabled).toBe(true);
  });
  it("modified click opens directly; ordinary internal click stays in the editor", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    act(() => editor.view.dom.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true })));
    expect(open).toHaveBeenCalledOnce();
    act(() => { editor.commands.setContent('<p><a href="/notes/target">internal</a></p>'); });
    act(() => editor.view.dom.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(navigate).not.toHaveBeenCalled(); expect(document.querySelector('[aria-label="链接卡片"]')).not.toBeNull();
  });
  it("closes on Escape, outside pointer, scroll and hover departure", () => {
    hover(); act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(document.querySelector('[aria-label="链接卡片"]')).toBeNull();
    hover(); act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))); expect(document.querySelector('[aria-label="链接卡片"]')).toBeNull();
    hover(); act(() => { vi.advanceTimersByTime(201); window.dispatchEvent(new Event("scroll")); }); expect(document.querySelector('[aria-label="链接卡片"]')).toBeNull();
    hover(); act(() => editor.view.dom.querySelector("a")!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))); act(() => vi.advanceTimersByTime(180)); expect(document.querySelector('[aria-label="链接卡片"]')).toBeNull();
  });
  it("maps unrelated document edits and dismisses if the linked content is changed remotely", () => {
    hover(); click("编辑");
    act(() => { editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "prefix" }] }); });
    draft("example.org"); submit(); expect(editor.view.dom.querySelector("a")?.textContent).toBe("linked words");
    hover(); click("编辑"); act(() => { editor.commands.insertContentAt(10, "remote "); }); expect(document.querySelector("input")).toBeNull();
  });
  it("dismisses a new-link draft if a remote collaborator changes its marks", () => {
    act(() => { editor.commands.setTextSelection({ from: 14, to: 19 }); });
    request();
    act(() => { editor.commands.setLink({ href: "https://remote.example.com" }); });
    expect(document.querySelector("input")).toBeNull();
  });
  it("IME Enter does not submit the URL field", () => {
    hover(); click("编辑"); draft("example.org");
    const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229, bubbles: true, cancelable: true });
    act(() => document.querySelector("input")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); expect(href()).toBe("https://example.com");
  });
  it("does not mistake an external /notes/ URL for an internal target", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    act(() => { editor.commands.setContent('<p><a href="https://external.com/notes/target">external</a></p>'); states = { "note:target": { resource_id: "target", resource_type: "note", state: "missing", title: null } }; render(); });
    hover(); expect(button("打开").disabled).toBe(false); click("打开"); expect(open).toHaveBeenCalledWith("https://external.com/notes/target", "_blank", "noopener,noreferrer");
  });
});
