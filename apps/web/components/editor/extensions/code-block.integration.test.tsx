// @vitest-environment jsdom
/**
 * 真实装配（buildEditorExtensions + EditorContent）下的代码块 NodeView：DOM 仍是 pre > code，
 * 文本由 ProseMirror 的 contentDOM 承载并随事务更新；pre 带 data-id；wrap 只在开启时输出。
 */
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEditorExtensions } from "../editor-extensions";

const CODE = "const a = 1;\nconsole.log(a);";

function Harness({ onReady }: { onReady: (editor: Editor) => void }) {
  const editor = useEditor({
    extensions: buildEditorExtensions({ collab: null, disableTaskItemToggle: false, getInternalLinkStates: () => ({}) }),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "p-1" }, content: [{ type: "text", text: "before" }] },
        { type: "codeBlock", attrs: { id: "cb-1" }, content: [{ type: "text", text: CODE }] },
      ],
    },
    editorProps: { handleScrollToSelection: () => true },
  });
  useEffect(() => { if (editor) onReady(editor); }, [editor, onReady]);
  return <EditorContent editor={editor} />;
}

describe("code block node view inside the assembled editor", () => {
  let root: Root, host: HTMLDivElement, editor: Editor;
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 760, height: 120, top: 300, bottom: 420, left: 20, right: 780, x: 20, y: 300, toJSON() {} });
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    await act(async () => { root.render(<Harness onReady={(instance) => { editor = instance; }} />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });
  afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function codePos() {
    let found = -1;
    editor.state.doc.forEach((node, offset) => { if (found === -1 && node.type.name === "codeBlock") found = offset; });
    return found;
  }

  it("renders pre > code through the node view, keeps data-id on pre, and tracks text and wrap changes", async () => {
    const wrapper = host.querySelector<HTMLElement>(".node-codeBlock .organize-code-block");
    expect(wrapper).not.toBeNull();
    const pre = wrapper!.querySelector<HTMLPreElement>(":scope > pre")!;
    expect(pre).not.toBeNull();
    expect(pre.getAttribute("data-id")).toBe("cb-1");
    expect(pre.style.whiteSpace).toBe("pre");
    const code = pre.querySelector<HTMLElement>(":scope > code")!;
    expect(code).not.toBeNull();
    expect(code.textContent).toBe(CODE);
    expect(document.querySelector('[aria-label="代码块工具栏"]')).toBeNull();

    await act(async () => { editor.commands.insertContentAt(codePos() + 1, "// note\n"); });
    expect(code.textContent).toBe(`// note\n${CODE}`);
    expect(editor.getHTML()).toContain('<pre data-id="cb-1"><code>// note');

    await act(async () => {
      const pos = codePos();
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, wrap: true, language: "typescript" }));
    });
    const updatedPre = host.querySelector<HTMLPreElement>(".organize-code-block > pre")!;
    expect(updatedPre.style.whiteSpace).toBe("pre-wrap");
    expect(updatedPre.getAttribute("data-wrap")).toBe("true");
    expect(updatedPre.getAttribute("data-language")).toBe("typescript");
    expect(updatedPre.querySelector("code")?.textContent).toBe(`// note\n${CODE}`);
    expect(editor.getHTML()).toContain('<pre data-id="cb-1" data-wrap="true"><code class="language-typescript">');

    await act(async () => { editor.commands.setNodeSelection(codePos()); });
    expect(document.querySelector('[aria-label="代码块工具栏"]')).not.toBeNull();
    expect(host.querySelector(".node-codeBlock")?.classList.contains("ProseMirror-selectednode")).toBe(true);
  });
});
