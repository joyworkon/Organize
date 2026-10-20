// @vitest-environment jsdom
/**
 * 代码块 NodeView + 工具栏：语言写入 attrs.language（一次 Undo 还原）、wrap 可选属性缺省不改旧文档
 * 序列化、复制走 clipboard、只读只留复制、整块选中抑制文字气泡、渲染属性落在 pre 上。
 */
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { NodeViewProps } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/hooks/use-toast";
import { BlockStyle } from "./block-style";
import { CodeBlockView, OrganizeCodeBlock } from "./code-block";
import { shouldShowTextToolbar } from "../block-interaction";

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}

const CODE = "const a = 1;\nconsole.log(a);";
const LEGACY_DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { id: "p-1" }, content: [{ type: "text", text: "before" }] },
    { type: "codeBlock", attrs: { id: "cb-1" }, content: [{ type: "text", text: CODE }] },
    { type: "paragraph", attrs: { id: "p-2" }, content: [{ type: "text", text: "after" }] },
  ],
};
const TYPES = ["paragraph", "codeBlock"];

function createEditor(content: JSONContent = LEGACY_DOC, legacyCodeBlock = false) {
  return new Editor({
    extensions: legacyCodeBlock
      ? [StarterKit, BlockStyle, UniqueID.configure({ types: TYPES })]
      : [StarterKit.configure({ codeBlock: false }), OrganizeCodeBlock, BlockStyle, UniqueID.configure({ types: TYPES })],
    editorProps: { handleScrollToSelection: () => true },
    content,
  });
}

describe("code block schema compatibility", () => {
  it("legacy JSON keeps id and null language, only gains wrap=false, and serializes identical HTML", () => {
    const legacy = createEditor(LEGACY_DOC, true);
    const current = createEditor(LEGACY_DOC);
    const legacyBlock = legacy.getJSON().content![1];
    const currentBlock = current.getJSON().content![1];
    expect(currentBlock.attrs).toEqual({ ...legacyBlock.attrs, wrap: false });
    expect(currentBlock.attrs).toMatchObject({ id: "cb-1", language: null, wrap: false });
    expect(current.getHTML()).toBe(legacy.getHTML());
    expect(current.getHTML()).toContain('<pre data-id="cb-1"><code>');
    expect(current.getHTML()).not.toContain("data-wrap");
    legacy.destroy(); current.destroy();
  });

  it("parses data-wrap and language classes from HTML and renders them back", () => {
    const editor = createEditor();
    editor.commands.setContent('<pre data-wrap="true"><code class="language-go">x := 1</code></pre><pre><code>plain</code></pre>');
    const [wrapped, plain] = editor.getJSON().content!;
    expect(wrapped.attrs).toMatchObject({ language: "go", wrap: true });
    expect(plain.attrs).toMatchObject({ language: null, wrap: false });
    expect(editor.getHTML()).toContain('data-wrap="true"');
    expect(editor.getHTML()).toContain('<code class="language-go">');
    editor.destroy();
  });

  it("slash-style insertion and toggleCodeBlock create blocks without language or wrap", () => {
    const editor = createEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "text" }] }] });
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "codeBlock", content: [] });
    expect(editor.getJSON().content![1].attrs).toMatchObject({ language: null, wrap: false });
    editor.commands.setTextSelection(2);
    editor.commands.toggleCodeBlock();
    expect(editor.getJSON().content![0]).toMatchObject({ type: "codeBlock", attrs: { language: null, wrap: false } });
    editor.destroy();
  });
});

describe("code block toolbar", () => {
  let editor: Editor, root: Root, host: HTMLDivElement;
  function codePos() {
    let found: number | undefined;
    editor.state.doc.forEach((node, offset) => { if (found === undefined && node.type.name === "codeBlock") found = offset; });
    return found;
  }
  function codeNode() { const pos = codePos(); return pos === undefined ? null : editor.state.doc.nodeAt(pos); }
  function render() {
    const node = codeNode();
    root.render(node ? <CodeBlockView {...{ editor, node, getPos: codePos, selected: false } as unknown as NodeViewProps} /> : null);
  }
  function toolbar() { return document.querySelector<HTMLElement>('[aria-label="代码块工具栏"]'); }
  function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((e) => e.getAttribute("aria-label") === label || e.textContent === label);
    if (!found) throw new Error(`Missing button: ${label}`); return found;
  }
  function click(label: string) { act(() => button(label).click()); }
  function pointer(element: Element, type: string, init: PointerEventInit = {}) { act(() => element.dispatchEvent(new TestPointerEvent(type, { bubbles: true, cancelable: true, ...init }))); }
  function radio(label: string) {
    const found = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((e) => e.textContent === label);
    if (!found) throw new Error(`Missing radio: ${label}`); return found;
  }
  function focusEditor(focused: boolean) {
    act(() => { editor.emit(focused ? "focus" : "blur", { editor, event: new FocusEvent(focused ? "focus" : "blur"), transaction: editor.state.tr }); });
  }
  function caretInside() { act(() => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, codePos()! + 3))); }); }
  function attrs() { return codeNode()!.attrs; }
  function pre() { return host.querySelector("pre")!; }
  async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 760, height: 120, top: 300, bottom: 420, left: 20, right: 780, x: 20, y: 300, toJSON() {} });
    Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn(); Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.scrollIntoView = vi.fn();
    useToastStore.setState({ toasts: [] });
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    editor = createEditor();
    editor.on("transaction", render); act(render);
  });
  afterEach(() => { act(() => root.unmount()); editor.off("transaction", render); editor.destroy(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("renders pre with data-id and keeps the default no-wrap appearance", () => {
    expect(pre().getAttribute("data-id")).toBe("cb-1");
    expect(pre().style.whiteSpace).toBe("pre");
    expect(pre().hasAttribute("data-wrap")).toBe(false);
    expect(pre().hasAttribute("data-language")).toBe(false);
    expect(toolbar()).toBeNull();
  });

  it("shows for a focused caret, hides on blur or a cross-block range, and stays for a node selection", () => {
    caretInside(); expect(toolbar()).toBeNull();
    focusEditor(true); expect(toolbar()).not.toBeNull();
    focusEditor(false); expect(toolbar()).toBeNull();
    act(() => { editor.commands.setNodeSelection(codePos()!); }); expect(toolbar()).not.toBeNull();
    act(() => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, codePos()! + 4))); }); expect(toolbar()).toBeNull();
    focusEditor(true);
    act(() => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, codePos()! + 2, codePos()! + 6))); }); expect(toolbar()).toBeNull();
    act(() => { editor.commands.selectAll(); }); expect(toolbar()).toBeNull();
  });

  it("node selection suppresses the text bubble like images do", () => {
    act(() => { editor.commands.setNodeSelection(codePos()!); });
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(shouldShowTextToolbar({ editor, state: editor.state, view: editor.view, element: document.createElement("div"), from: editor.state.selection.from, to: editor.state.selection.to })).toBe(false);
  });

  it("picks a language into attrs, reflects it on pre and HTML, keeps the block selected, and undoes once", async () => {
    act(() => { editor.commands.setNodeSelection(codePos()!); });
    expect(button("代码语言").textContent).toContain("纯文本");
    pointer(button("代码语言"), "pointerdown");
    expect(radio("纯文本").getAttribute("aria-checked")).toBe("true");
    act(() => radio("Python").click()); await flush();
    expect(attrs().language).toBe("python");
    expect(attrs().id).toBe("cb-1");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(pre().getAttribute("data-language")).toBe("python");
    expect(editor.getHTML()).toContain('<code class="language-python">');
    expect(button("代码语言").textContent).toContain("Python");
    pointer(button("代码语言"), "pointerdown");
    expect(radio("Python").getAttribute("aria-checked")).toBe("true");
    act(() => radio("C++").click()); await flush();
    expect(attrs().language).toBe("cpp");
    act(() => { editor.commands.undo(); }); expect(attrs().language).toBe("python");
    act(() => { editor.commands.undo(); }); expect(attrs().language).toBeNull();
    expect(editor.getJSON().content![1].attrs).toMatchObject({ id: "cb-1", language: null, wrap: false });
  });

  it("lists an unknown stored language as the checked option and plain text clears it", async () => {
    act(() => {
      const pos = codePos()!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, language: "kotlin" }));
      editor.commands.setNodeSelection(pos);
    });
    expect(button("代码语言").textContent).toContain("kotlin");
    pointer(button("代码语言"), "pointerdown");
    expect(radio("kotlin").getAttribute("aria-checked")).toBe("true");
    act(() => radio("纯文本").click()); await flush();
    expect(attrs().language).toBeNull();
    expect(pre().hasAttribute("data-language")).toBe(false);
  });

  it("toggles wrap into the document, inline white-space and data-wrap, and undoes", () => {
    act(() => { editor.commands.setNodeSelection(codePos()!); });
    expect(button("自动换行").getAttribute("aria-pressed")).toBe("false");
    click("自动换行");
    expect(attrs().wrap).toBe(true);
    expect(pre().style.whiteSpace).toBe("pre-wrap");
    expect(pre().getAttribute("data-wrap")).toBe("true");
    expect(editor.getHTML()).toContain('<pre data-id="cb-1" data-wrap="true">');
    expect(button("自动换行").getAttribute("aria-pressed")).toBe("true");
    click("自动换行");
    expect(attrs().wrap).toBe(false); expect(pre().style.whiteSpace).toBe("pre"); expect(pre().hasAttribute("data-wrap")).toBe(false);
    act(() => { editor.commands.undo(); }); expect(attrs().wrap).toBe(true);
    act(() => { editor.commands.undo(); }); expect(attrs().wrap).toBe(false);
  });

  it("copies the whole block text and reports clipboard failures", async () => {
    act(() => { editor.commands.setNodeSelection(codePos()!); });
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    await act(async () => { button("复制代码").click(); });
    expect(write).toHaveBeenCalledWith(CODE);
    expect(useToastStore.getState().toasts[0]?.title).toBe("代码已复制");
    write.mockRejectedValueOnce(new Error("denied"));
    await act(async () => { button("复制代码").click(); });
    expect(useToastStore.getState().toasts[0]).toMatchObject({ variant: "destructive" });
    expect(attrs()).toMatchObject({ id: "cb-1", language: null, wrap: false });
  });

  it("read-only keeps copy without focus and hides language and wrap controls", async () => {
    act(() => { editor.setEditable(false); });
    caretInside();
    expect(toolbar()).not.toBeNull();
    expect(document.body.textContent).not.toContain("自动换行");
    expect(document.querySelector('[aria-label="代码语言"]')).toBeNull();
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    await act(async () => { button("复制代码").click(); });
    expect(write).toHaveBeenCalledWith(CODE);
    act(() => { editor.setEditable(true); });
    expect(toolbar()).toBeNull();
  });

  it("puts block background rendering on the pre, as before the node view", () => {
    act(() => { editor.commands.setBlockBackground(codePos()!, "#ffeeee"); });
    expect(pre().getAttribute("data-block-background")).toBe("#ffeeee");
    expect(pre().style.backgroundColor).not.toBe("");
    expect(pre().style.whiteSpace).toBe("pre");
    act(() => { editor.commands.setBlockBackground(codePos()!, null); });
    expect(pre().hasAttribute("data-block-background")).toBe(false);
    expect(pre().style.backgroundColor).toBe("");
  });
});
