// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeViewProps } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResizableImage, ResizableImageView } from "./resizable-image";
import { shouldShowTextToolbar } from "../block-interaction";
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
describe("image block controls", () => {
  let editor: Editor, root: Root, host: HTMLDivElement;
  const src = "https://example.com/original.png";
  function render() {
    const node = editor.state.doc.firstChild!;
    root.render(node.type.name === "image" ? <ResizableImageView {...{ editor, node, getPos: () => editor.state.doc.firstChild?.type.name === "image" ? 0 : undefined, selected: editor.state.selection instanceof NodeSelection } as unknown as NodeViewProps} /> : null);
  }
  function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((e) => e.getAttribute("aria-label") === label || e.textContent === label);
    if (!found) throw new Error(`Missing button: ${label}`); return found;
  }
  function click(label: string) { act(() => button(label).click()); }
  function pointer(element: Element, type: string, init: PointerEventInit = {}) { act(() => element.dispatchEvent(new TestPointerEvent(type, { bubbles: true, cancelable: true, ...init }))); }
  function menu() { pointer(button("更多图片操作"), "pointerdown"); }
  function attrs() { return editor.state.doc.firstChild!.attrs; }
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 760, height: 200, top: 300, bottom: 500, left: 20, right: 780, x: 20, y: 300, toJSON() {} });
    Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn(); Element.prototype.hasPointerCapture = vi.fn(() => false);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    editor = new Editor({ extensions: [StarterKit, ResizableImage], editorProps: { handleScrollToSelection: () => true }, content: { type: "doc", content: [{ type: "image", attrs: { src, alt: "原说明", width: 320 } }, { type: "paragraph" }] } });
    editor.commands.setNodeSelection(0); editor.on("transaction", render); act(render);
  });
  afterEach(() => { act(() => root.unmount()); editor.off("transaction", render); editor.destroy(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("presets preserve attrs and undo independently", () => {
    for (const [label, width] of [["50%", 380], ["75%", 570], ["100%", 760], ["自适应", null]] as const) {
      click(label); expect(attrs().width).toBe(width); expect(attrs().alt).toBe("原说明"); expect(button(label).getAttribute("aria-pressed")).toBe("true");
    }
    act(() => { editor.commands.undo(); }); expect(attrs().width).toBe(760);
    act(() => { editor.commands.undo(); }); expect(attrs().width).toBe(570);
  });
  it("saves alt, cancels with Escape, and undoes", () => {
    click("替代文字"); const input = document.querySelector<HTMLInputElement>("#organize-image-alt")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "新的说明"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(attrs().alt).toBe("新的说明"); act(() => { editor.commands.undo(); }); expect(attrs().alt).toBe("原说明");
    click("替代文字"); act(() => document.querySelector("#organize-image-alt")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector("#organize-image-alt")).toBeNull(); expect(attrs().alt).toBe("原说明");
  });
  it("two keyboard handles expose aria values and drag commits once or cancels", () => {
    const handles = [...host.querySelectorAll<HTMLElement>('[role="separator"]')]; expect(handles).toHaveLength(2);
    expect(handles[0].getAttribute("aria-valuemin")).toBe("96"); expect(handles[0].getAttribute("aria-valuemax")).toBe("760");
    act(() => handles[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }))); expect(attrs().width).toBe(384);
    act(() => handles[0].dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))); expect(attrs().width).toBe(320);
    act(() => handles[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))); expect(attrs().width).toBe(96);
    pointer(handles[0], "pointerdown", { clientX: 100 }); pointer(handles[0], "pointermove", { clientX: 50 });
    expect(host.querySelector("output")?.textContent).toContain("760px"); pointer(handles[0], "pointerup"); expect(attrs().width).toBe(760);
    act(() => { editor.commands.undo(); }); expect(attrs().width).toBe(96);
    pointer(handles[1], "pointerdown", { clientX: 100 }); pointer(handles[1], "pointermove", { clientX: -100 }); pointer(handles[1], "pointercancel"); expect(attrs().width).toBe(96);
  });
  it("copies source, exposes links and deletes with undo", async () => {
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    menu(); await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) => e.textContent === "复制图片链接")!.click()); expect(copy).toHaveBeenCalledWith(src);
    menu(); expect(document.querySelector<HTMLAnchorElement>('a[download]')?.href).toBe(src);
    act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) => e.textContent === "删除图片")!.click()); expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    act(() => { editor.commands.undo(); }); expect(attrs()).toMatchObject({ src, width: 320, alt: "原说明" });
  });
  it("revocation hides edits; readonly click views and returns focus", async () => {
    act(() => editor.setEditable(false)); expect(document.body.textContent).not.toContain("替代文字"); expect(host.querySelectorAll('[role="separator"]')).toHaveLength(0); expect(button("复制图片链接")).toBeTruthy();
    act(() => host.querySelector("img")!.click()); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); click("关闭图片查看器");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(host.querySelector(".organize-image-frame"));
  });
  it("double click views without resetting width and suppresses text bubble", () => {
    act(() => host.querySelector("img")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(attrs().width).toBe(320);
    expect(shouldShowTextToolbar({ editor, state: editor.state, view: editor.view, element: document.createElement("div"), from: 0, to: 1 })).toBe(false);
  });
  function chooseFile() {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { Object.defineProperty(this, "files", { value: [new File(["image"], "replacement.png", { type: "image/png" })] }); this.dispatchEvent(new Event("change")); });
  }
  it("replacement uploads preserve attributes and undo", async () => {
    chooseFile(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: "https://example.com/new.png" }) }));
    await act(async () => button("替换图片").click()); expect(attrs()).toMatchObject({ src: "https://example.com/new.png", width: 320, alt: "原说明" });
    act(() => { editor.commands.undo(); }); expect(attrs().src).toBe(src);
  });
  it("failed upload falls back to base64", async () => {
    chooseFile(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await act(async () => { button("替换图片").click(); await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(attrs().src).toMatch(/^data:image\/png;base64,/); expect(attrs().width).toBe(320);
  });
  it("late uploads respect permission loss and concurrent src changes", async () => {
    chooseFile(); let finish!: (value: unknown) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    click("替换图片"); act(() => editor.setEditable(false));
    await act(async () => { finish({ ok: true, json: async () => ({ url: "https://example.com/new.png" }) }); }); expect(attrs().src).toBe(src);
    act(() => editor.setEditable(true)); click("替换图片"); act(() => { editor.commands.updateAttributes("image", { src: "https://example.com/concurrent.png" }); });
    await act(async () => { finish({ ok: true, json: async () => ({ url: "https://example.com/new.png" }) }); }); expect(attrs().src).toBe("https://example.com/concurrent.png");
  });
});
