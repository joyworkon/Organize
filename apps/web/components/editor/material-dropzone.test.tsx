// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialProcessorExtension, MaterialResult, OrganizePlugin, PluginContext } from "@organize/plugin-sdk";
import { usePluginStore } from "@/lib/plugin/store";
import { MaterialDropzone } from "./material-dropzone";

const result: MaterialResult = { title: "整理结果", category: "资料", tags: [], blocks: [{ type: "paragraph", text: "识别出的内容" }] };

describe("MaterialDropzone", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let editor: Editor;
  let handler: ReturnType<typeof vi.fn<MaterialProcessorExtension["handler"]>>;
  let insertFiles: ReturnType<typeof vi.fn<(files: File[], pos?: number) => Promise<void>>>;
  let unmounted = false;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    editor = new Editor({ extensions: [StarterKit], content: "<p>原有内容</p>" });
    handler = vi.fn<MaterialProcessorExtension["handler"]>().mockResolvedValue(result);
    insertFiles = vi.fn<(files: File[], pos?: number) => Promise<void>>().mockResolvedValue(undefined);
    const plugin: OrganizePlugin = { id: "test", name: "测试整理", version: "1", description: "", extensions: [{ type: "material-processor", id: "organize", label: "整理", handler }] };
    usePluginStore.setState({ activePlugins: new Map([["test", plugin]]), contexts: new Map([["test", {} as PluginContext]]) });
    unmounted = false;
    act(() => root.render(createElement(MaterialDropzone, { editor, insertFiles })));
  });

  afterEach(() => {
    if (!unmounted) act(() => root.unmount());
    editor.destroy();
    container.remove();
    usePluginStore.setState({ activePlugins: new Map(), contexts: new Map() });
  });

  const drop = async () => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["原文"], "notes.txt")] } });
    await act(async () => { container.querySelector("section")!.dispatchEvent(event); });
  };
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(label));
    expect(button).toBeDefined();
    await act(async () => { button!.click(); });
  };

  it("automatically appends editable content, preserves the existing selection, and can undo only the import", async () => {
    editor.commands.setTextSelection({ from: 1, to: 4 });
    await drop();
    expect(handler).toHaveBeenCalledOnce();
    expect(editor.getText()).toContain("原有内容");
    expect(editor.getText()).toContain("识别出的内容");
    expect(editor.getText()).toContain("notes.txt");
    expect(container.textContent).toContain("已将「整理结果」追加");
    editor.commands.undo();
    expect(editor.getText()).toBe("原有内容");
  });

  it("uses the latest document end after edits during processing", async () => {
    let resolve!: (value: MaterialResult) => void;
    handler.mockReturnValue(new Promise<MaterialResult>((done) => { resolve = done; }));
    await drop();
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "等待时补写" }] });
    await act(async () => resolve(result));
    expect(editor.getText().indexOf("等待时补写")).toBeLessThan(editor.getText().indexOf("整理结果"));
    editor.commands.undo();
    expect(editor.getText()).toContain("等待时补写");
    expect(editor.getText()).not.toContain("整理结果");
  });

  it("blocks duplicate drops while processing and discards a cancelled response", async () => {
    let resolve!: (value: MaterialResult) => void;
    handler.mockReturnValue(new Promise<MaterialResult>((done) => { resolve = done; }));
    await drop();
    await drop();
    expect(handler).toHaveBeenCalledOnce();
    await click("取消");
    expect(handler.mock.calls[0][0].signal?.aborted).toBe(true);
    await act(async () => resolve(result));
    expect(editor.getText()).toBe("原有内容");
  });

  it("does not insert after unmount or permission loss", async () => {
    let resolve!: (value: MaterialResult) => void;
    handler.mockReturnValue(new Promise<MaterialResult>((done) => { resolve = done; }));
    await drop();
    editor.setEditable(false);
    await act(async () => resolve(result));
    expect(container.textContent).toContain("只读");
    expect(editor.getText()).toBe("原有内容");
    editor.setEditable(true);
    handler.mockReturnValue(new Promise<MaterialResult>((done) => { resolve = done; }));
    await drop();
    act(() => root.unmount());
    unmounted = true;
    await act(async () => resolve(result));
    expect(editor.getText()).toBe("原有内容");
  });

  it("keeps failures retryable and allows normal attachment insertion", async () => {
    handler.mockRejectedValueOnce(new Error("视觉模型不可用"));
    await drop();
    expect(editor.getText()).toBe("原有内容");
    expect(container.textContent).toContain("视觉模型不可用");
    await click("作为普通附件插入");
    expect(insertFiles.mock.calls[0][0][0].name).toBe("notes.txt");
    await click("重试整理");
    expect(editor.getText()).toContain("识别出的内容");
  });

  it("resets processing state when the editor instance changes", async () => {
    let resolve!: (value: MaterialResult) => void;
    handler.mockReturnValue(new Promise<MaterialResult>((done) => { resolve = done; }));
    await drop();
    const oldEditor = editor;
    editor = new Editor({ extensions: [StarterKit], content: "<p>另一实例</p>" });
    act(() => root.render(createElement(MaterialDropzone, { editor, insertFiles })));
    expect(container.textContent).not.toContain("正在识别");
    await act(async () => resolve(result));
    expect(editor.getText()).toBe("另一实例");
    oldEditor.destroy();
  });

  it("does not call a disabled processor and rejects unsafe plugin results", async () => {
    handler.mockResolvedValueOnce({ ...result, blocks: [{ type: "htmlEmbed", html: "<script>bad</script>" }] } as unknown as MaterialResult);
    await drop();
    expect(editor.getText()).toBe("原有内容");
    expect(container.textContent).toContain("格式不完整");
    act(() => usePluginStore.setState({ activePlugins: new Map() }));
    await drop();
    expect(handler).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("插件管理");
  });
});
