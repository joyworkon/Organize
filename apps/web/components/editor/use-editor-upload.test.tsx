// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileAttachment } from "./extensions/file-attachment";
import { BLOCK_COMMANDS, commandMatches, executeNestedCommand } from "./block-commands";
import { useEditorUpload } from "./use-editor-upload";

describe("slash file upload", () => {
  let editor: Editor, root: Root, host: HTMLDivElement, upload: ReturnType<typeof useEditorUpload>, picker: HTMLInputElement;
  function Harness() { upload = useEditorUpload(editor); return null; }
  function choose(files: File[]) { Object.defineProperty(picker, "files", { configurable: true, value: files }); act(() => picker.dispatchEvent(new Event("change"))); }
  const file = () => new File(["pdf"], "report.pdf", { type: "application/pdf" });
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    editor = new Editor({ extensions: [StarterKit, Image, FileAttachment], content: "<p></p><p>after</p>", editorProps: { handleScrollToSelection: () => true } });
    act(() => root.render(<Harness />));
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { picker = this; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: "https://example.com/report.pdf" }) }));
  });
  afterEach(() => { act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1)); }); }
  it("matches all file keywords and emits the same event contract as image", () => {
    const command = BLOCK_COMMANDS.find((item) => item.id === "file")!;
    for (const query of ["附件", "文件", "file", "upload", "pdf"]) expect(commandMatches(command, query)).toBe(true);
    const listener = vi.fn(); editor.view.dom.addEventListener("organize-editor-action", listener);
    command.run(editor, 0);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ type: "file", pos: 0 });
  });
  it("cancel creates no blocks and successful upload replaces only the empty paragraph", async () => {
    act(() => upload.uploadAttachment(0)); const before = editor.getJSON(); choose([]); await flush(); expect(editor.getJSON()).toEqual(before);
    choose([file()]); await flush();
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["fileAttachment", "paragraph"]);
    expect(editor.state.doc.firstChild!.attrs).toMatchObject({ name: "report.pdf", mime: "application/pdf", size: 3, src: "https://example.com/report.pdf" }); expect(editor.state.doc.lastChild!.textContent).toBe("after");
  });
  it("nested emit defers removal until upload and preserves sibling text", async () => {
    editor.commands.setContent("<blockquote><p>/file</p><p>keep</p></blockquote><p>after</p>");
    editor.view.dom.addEventListener("organize-editor-action", (event) => {
      const detail = (event as CustomEvent).detail; upload.uploadAttachment(detail.pos, detail.nested, detail.range);
    });
    expect(executeNestedCommand(editor, "file", { from: 2, to: 7 })).toBe("handled");
    expect(editor.getText()).toContain("/file"); choose([file()]); await flush();
    expect(editor.getText()).not.toContain("/file"); expect(editor.getText()).toContain("keep"); expect(editor.getText()).toContain("after");
    expect(JSON.stringify(editor.getJSON().content?.[0])).toContain("fileAttachment");
  });
  it("images go through the existing image path", async () => {
    act(() => upload.uploadAttachment(0)); choose([new File(["png"], "a.png", { type: "image/png" })]); await flush(); expect(editor.state.doc.firstChild!.type.name).toBe("image");
  });
  it.each(["revoke", "destroy"])("late insertion respects %s", async (action) => {
    let finish!: (value: unknown) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    act(() => upload.uploadAttachment(0)); choose([file()]); const before = editor.getJSON();
    if (action === "revoke") editor.setEditable(false); else editor.destroy();
    await act(async () => { finish({ ok: true, json: async () => ({ url: "https://example.com/late" }) }); }); expect(editor.getJSON()).toEqual(before);
  });
});
