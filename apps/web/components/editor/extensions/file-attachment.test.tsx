// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import UniqueID from "@tiptap/extension-unique-id";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeViewProps } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/hooks/use-toast";
import { FileAttachment, FileAttachmentView } from "./file-attachment";
import { shouldShowTextToolbar } from "../block-interaction";
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
describe("attachment toolbar", () => {
  let editor: Editor, root: Root, host: HTMLDivElement;
  const src = "https://example.com/original.pdf";
  function render() {
    const node = editor.state.doc.firstChild!;
    root.render(node.type.name === "fileAttachment" ? <FileAttachmentView {...{ editor, node, getPos: () => editor.state.doc.firstChild?.type.name === "fileAttachment" ? 0 : undefined, selected: editor.state.selection instanceof NodeSelection } as unknown as NodeViewProps} /> : null);
  }
  function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((e) => e.getAttribute("aria-label") === label || e.textContent === label);
    if (!found) throw new Error(`Missing button: ${label}`); return found;
  }
  function click(label: string) { act(() => button(label).click()); }
  function attrs() { return editor.state.doc.firstChild!.attrs; }
  function toolbar() { return document.querySelector('[aria-label="附件工具栏"]'); }
  function draft(value: string) {
    const input = document.querySelector<HTMLInputElement>('input:not([type="file"])')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); return input;
  }
  function choose(type = "application/pdf") {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
      expect(this.multiple).toBe(false);
      Object.defineProperty(this, "files", { value: [new File(["new"], "new.pdf", { type })] }); this.dispatchEvent(new Event("change"));
    });
  }
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 240, height: 60, top: 300, bottom: 360, left: 20, right: 260, x: 20, y: 300, toJSON() {} });
    Element.prototype.scrollIntoView = vi.fn(); useToastStore.setState({ toasts: [] });
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    editor = new Editor({ extensions: [StarterKit, FileAttachment, Image, UniqueID.configure({ types: ["fileAttachment", "image", "paragraph"] })], editorProps: { handleScrollToSelection: () => true }, content: { type: "doc", content: [{ type: "fileAttachment", attrs: { src, name: "原文件.pdf", mime: "application/pdf", size: 120, id: "file-1" } }, { type: "paragraph", attrs: { id: "p-1" } }] } });
    editor.commands.setNodeSelection(0); editor.on("transaction", render); act(render);
  });
  afterEach(() => { act(() => root.unmount()); editor.off("transaction", render); editor.destroy(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("portals above the block, hides on blur/deselection, and excludes text bubble", () => {
    expect(toolbar()?.parentElement).toBe(document.body); expect((toolbar() as HTMLElement).style.top).toBe("232px");
    expect(shouldShowTextToolbar({ editor, state: editor.state, view: editor.view, element: document.createElement("div"), from: 0, to: 1 })).toBe(false);
    act(() => editor.emit("blur", { editor, event: new FocusEvent("blur"), transaction: editor.state.tr })); expect(toolbar()).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>(".file-attachment-card")!.click()); expect(toolbar()).not.toBeNull();
    act(() => { editor.commands.setTextSelection(2); }); expect(toolbar()).toBeNull();
  });
  it("renames with trim/fallback and independently undoes while preserving attrs", () => {
    click("重命名附件"); const input = draft("  新文件.pdf  ");
    act(() => input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(attrs()).toMatchObject({ name: "新文件.pdf", src, size: 120, mime: "application/pdf", id: "file-1" });
    act(() => { editor.commands.undo(); }); expect(attrs().name).toBe("原文件.pdf");
    click("重命名附件"); const empty = draft("   "); act(() => empty.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); expect(attrs().name).toBe("附件");
  });
  it("IME Enter does not submit and cancel/Escape do not write", () => {
    click("重命名附件"); const input = draft("草稿");
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }); act(() => input.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true);
    }
    expect(attrs().name).toBe("原文件.pdf"); click("取消"); expect(attrs().name).toBe("原文件.pdf");
    click("重命名附件"); act(() => document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector("input")).toBeNull(); expect(attrs().name).toBe("原文件.pdf");
  });
  it("deletes through history and restores identical block", () => {
    const before = editor.getJSON(); act(() => button("更多附件操作").dispatchEvent(new TestPointerEvent("pointerdown", { bubbles: true, button: 0 })));
    act(() => document.querySelector<HTMLElement>('[role="menuitem"]')!.click()); expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    act(() => { editor.commands.undo(); }); expect(editor.getJSON()).toEqual(before);
  });
  it("read-only retains safe open/download/copy and reports failures", async () => {
    act(() => editor.setEditable(false)); expect(document.querySelector('[aria-label="重命名附件"]')).toBeNull(); expect(document.querySelector('[aria-label="替换附件"]')).toBeNull();
    const open = vi.spyOn(window, "open").mockReturnValue(null); click("打开附件"); expect(open).toHaveBeenCalledWith(src, "_blank", "noopener,noreferrer");
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    await act(async () => button("复制附件链接").click()); expect(copy).toHaveBeenCalledWith(src); expect(useToastStore.getState().toasts[0]?.title).toBe("附件链接已复制");
    copy.mockRejectedValueOnce(new Error("denied")); await act(async () => button("复制附件链接").click()); expect(useToastStore.getState().toasts[0]?.variant).toBe("destructive");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("CORS"))); await act(async () => button("下载附件").click()); expect(useToastStore.getState().toasts[0]?.title).toContain("下载失败"); expect(button("打开附件").disabled).toBe(false);
    act(() => { editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...attrs(), src: "javascript:alert(1)" })); }); expect(button("打开附件").disabled).toBe(true); expect(button("下载附件").disabled).toBe(true);
  });
  it.each(["video/mp4", "audio/mpeg"])("keeps controls and filename visible for %s", (mime) => {
    act(() => { editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...attrs(), mime })); });
    expect(host.querySelector("video[controls], audio[controls]")).not.toBeNull(); expect(host.querySelector(".file-attachment-name")?.textContent).toBe("原文件.pdf"); expect(toolbar()).not.toBeNull();
  });
  it("replaces once with uploaded metadata, preserves id and undoes", async () => {
    choose(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: "https://example.com/new.pdf", name: "new.pdf", mime: "application/pdf", size: 3 }) }));
    await act(async () => button("替换附件").click()); expect(attrs()).toMatchObject({ src: "https://example.com/new.pdf", name: "new.pdf", size: 3, mime: "application/pdf", id: "file-1" });
    act(() => { editor.commands.undo(); }); expect(attrs().src).toBe(src);
  });
  it("selected image replaces file with image and keeps id/undo", async () => {
    choose("image/png"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: "https://example.com/new.png" }) }));
    await act(async () => button("替换附件").click()); expect(editor.state.doc.firstChild!.type.name).toBe("image"); expect(attrs()).toMatchObject({ src: "https://example.com/new.png", id: "file-1" });
    act(() => { editor.commands.undo(); }); expect(editor.state.doc.firstChild!.type.name).toBe("fileAttachment"); expect(attrs().src).toBe(src);
  });
  it("failed uploads preserve old block", async () => {
    choose(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "offline" }) })); const before = editor.getJSON();
    await act(async () => button("替换附件").click()); expect(editor.getJSON()).toEqual(before); expect(useToastStore.getState().toasts[0]?.title).toContain("上传失败");
  });
  it.each(["revoke", "change", "delete", "destroy"])("late upload does not write after %s", async (action) => {
    choose(); let finish!: (value: unknown) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; }))); click("替换附件");
    act(() => {
      if (action === "revoke") editor.setEditable(false);
      if (action === "change") editor.commands.updateAttributes("fileAttachment", { src: "https://example.com/concurrent.pdf" });
      if (action === "delete") editor.commands.deleteSelection();
      if (action === "destroy") editor.destroy();
    });
    const before = editor.getJSON(); await act(async () => { finish({ ok: true, json: async () => ({ url: "https://example.com/late.pdf" }) }); }); expect(editor.getJSON()).toEqual(before);
  });
});
