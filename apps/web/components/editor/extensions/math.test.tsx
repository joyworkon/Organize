// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import UniqueID from "@tiptap/extension-unique-id";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeViewProps } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import katex from "katex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineMath, MathBlock, MathCommands, MathNodeView } from "./math";
import { MathEditorDialog, showMathEditor } from "../math-editor-dialog";
import { convertSelectedMath, deleteSelectedMath } from "../math-actions";
import { renderMath } from "../math-render";
import { shouldShowTextToolbar } from "../block-interaction";
import { toast } from "@/hooks/use-toast";
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const extensions = [StarterKit, InlineMath, MathBlock, MathCommands];
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("math document compatibility and atomic conversion", () => {
  it.each(["", "x^2", "\\frac{a}{b}", '<img src=x onerror="alert(1)">'])('round trips legacy latex %s without new attributes', (latex) => {
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "inlineMath", attrs: { latex } }] }, { type: "mathBlock", attrs: { latex } }] };
    const editor = new Editor({ extensions, content });
    const html = editor.getHTML();
    const expected = document.createElement("div");
    for (const isBlock of [false, true]) {
      const wrapper = document.createElement(isBlock ? "div" : "span");
      wrapper.setAttribute(isBlock ? "data-math-block" : "data-math-inline", ""); wrapper.setAttribute("data-latex", latex);
      wrapper.innerHTML = katex.renderToString(latex || "\\;", { throwOnError: false, displayMode: isBlock });
      if (isBlock) expected.append(wrapper); else { const paragraph = document.createElement("p"); paragraph.append(wrapper); expected.append(paragraph); }
    }
    expect(html).toBe(expected.innerHTML);
    const parsed = new Editor({ extensions, content: html });
    expect(editor.getJSON()).toEqual(content); expect(parsed.getJSON()).toEqual(content); expect(parsed.getHTML()).toBe(html);
    editor.destroy(); parsed.destroy();
  });

  it.each([false, true])("splits inline text without losing marked siblings, nested=%s; undo restores exact JSON", (nested) => {
    const paragraph = { type: "paragraph", content: [{ type: "text", text: "前", marks: [{ type: "bold" }] }, { type: "inlineMath", attrs: { latex: "x^2" } }, { type: "text", text: "后" }] };
    const editor = new Editor({ extensions, editorProps: { handleScrollToSelection: () => true }, content: { type: "doc", content: nested ? [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph] }] }] : [paragraph] } });
    const before = editor.getJSON(); let pos = 0; editor.state.doc.descendants((node, at) => { if (node.type.name === "inlineMath") pos = at; });
    editor.commands.setNodeSelection(pos); expect(convertSelectedMath(editor)).toBe(true);
    expect(editor.state.doc.textContent).toBe("前后"); expect((editor.state.selection as NodeSelection).node.attrs.latex).toBe("x^2");
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("mathBlock");
    const block = editor.getJSON(); expect(convertSelectedMath(editor)).toBe(true);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe("inlineMath");
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(block);
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before); editor.destroy();
  });
  it("keeps a standalone formula block ID on its paragraph across both conversions", () => {
    const editor = new Editor({ extensions: [...extensions, UniqueID.configure({ types: ["paragraph", "mathBlock"] })], editorProps: { handleScrollToSelection: () => true },
      content: { type: "doc", content: [{ type: "mathBlock", attrs: { id: "equation-id", latex: "x^2" } }, p("正文")] } });
    editor.commands.setNodeSelection(0);
    expect(convertSelectedMath(editor)).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild?.attrs.id).toBe("equation-id");
    expect(convertSelectedMath(editor)).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("mathBlock");
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ id: "equation-id", latex: "x^2" }); editor.destroy();
  });
  it("escapes unexpected renderer failures", () => {
    const spy = vi.spyOn(katex, "renderToString").mockImplementation(() => { throw new Error("failure"); });
    expect(renderMath('<img onerror="x">&', false)).toEqual({ error: true, html: '<span class="text-destructive">&lt;img onerror=&quot;x&quot;&gt;&amp;</span>' }); spy.mockRestore();
  });
});

describe("math editor dialog and selected NodeView", () => {
  let editor: Editor, root: Root, host: HTMLDivElement;
  function render() {
    let pos: number | undefined; editor.state.doc.descendants((node, at) => { if (pos === undefined && ["inlineMath", "mathBlock"].includes(node.type.name)) pos = at; });
    root.render(<><MathEditorDialog editor={editor} />{pos !== undefined && <MathNodeView {...{ editor, node: editor.state.doc.nodeAt(pos)!, getPos: () => pos, selected: editor.state.selection instanceof NodeSelection } as unknown as NodeViewProps} />}</>);
  }
  function button(name: string) { const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => (element.getAttribute("aria-label") || element.textContent) === name); if (!button) throw new Error(`Missing ${name}`); return button; }
  function click(name: string) { act(() => button(name).click()); }
  function input(value: string) {
    const source = document.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(source, value); source.dispatchEvent(new Event("input", { bubbles: true })); }); return source;
  }
  function key(element: Element, key: string, init: KeyboardEventInit = {}) { act(() => element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init }))); }
  const json = () => editor.getJSON();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 300, bottom: 400, left: 20, right: 520, x: 20, y: 300, width: 500, height: 100, toJSON() {} });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    editor = new Editor({ extensions, editorProps: { handleScrollToSelection: () => true }, content: { type: "doc", content: [{ type: "mathBlock", attrs: { latex: "x^2" } }, p("正文")] } });
    editor.commands.setNodeSelection(0); editor.on("transaction", render); act(render);
  });
  afterEach(() => { editor.off("transaction", render); act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("previews valid, empty and invalid input; cancel never mutates and save is undoable", () => {
    const before = json(); click("编辑公式"); expect(document.querySelector("textarea")?.value).toBe("x^2");
    input("\\frac{a}{b}"); expect(document.querySelector('.organize-math-preview .katex')).not.toBeNull();
    input(""); expect(document.body.textContent).toContain("输入公式后在此预览");
    input("\\frac{"); expect(document.querySelector('[data-invalid="true"]')).not.toBeNull(); expect(document.body.textContent).toContain("公式语法有误");
    click("取消"); expect(json()).toEqual(before);
    click("编辑公式"); const source = input("E=mc^2"); key(source, "Enter", { ctrlKey: true, isComposing: true }); expect(document.querySelector("textarea")).not.toBeNull();
    key(source, "Enter", { ctrlKey: true, keyCode: 229 }); expect(document.querySelector("textarea")).not.toBeNull();
    key(source, "Enter", { ctrlKey: true }); expect(document.querySelector("textarea")).toBeNull(); expect(editor.state.doc.firstChild?.attrs.latex).toBe("E=mc^2");
    act(() => { editor.commands.undo(); }); expect(json()).toEqual(before);
  });
  it("copies success/failure, deletes and undoes, and suppresses text bubble", async () => {
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    await act(async () => button("复制 LaTeX").click()); expect(copy).toHaveBeenCalledWith("x^2"); expect(toast).toHaveBeenCalledWith({ title: "公式源码已复制" });
    copy.mockRejectedValueOnce(new Error("denied")); await act(async () => button("复制 LaTeX").click()); expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: "destructive" }));
    expect(shouldShowTextToolbar({ editor, state: editor.state, view: editor.view, element: host, from: 0, to: 1 })).toBe(false);
    const before = json(); click("删除公式"); expect(editor.state.doc.firstChild?.type.name).toBe("paragraph"); act(() => { editor.commands.undo(); }); expect(json()).toEqual(before);
  });
  it("readonly only copies; revocation closes an open editor and rejects writes", () => {
    const before = json(); click("编辑公式"); input("changed"); const save = button("保存");
    act(() => editor.setEditable(false)); expect(document.querySelector("textarea")).toBeNull(); act(() => save.click()); expect(json()).toEqual(before);
    expect(document.querySelector('[aria-label="公式工具栏"]')?.querySelectorAll("button")).toHaveLength(1);
    act(() => host.querySelector<HTMLElement>(".organize-math-anchor")!.click()); expect(document.querySelector("textarea")).toBeNull();
    expect(convertSelectedMath(editor)).toBe(false); expect(deleteSelectedMath(editor)).toBe(false);
    act(() => showMathEditor(editor, { isBlock: true })); expect(document.querySelector("textarea")).toBeNull();
  });
  it("insertion supports empty latex and tracks selection through intervening edits", () => {
    act(() => { editor.commands.setTextSelection(2); });
    act(() => showMathEditor(editor, { isBlock: false }));
    input(""); click("保存"); expect(editor.getHTML()).toContain('data-math-inline="" data-latex=""');
    act(() => { editor.commands.setNodeSelection(0); }); click("编辑公式"); input("mapped");
    act(() => { editor.commands.insertContentAt(0, p("协作插入")); }); click("保存");
    expect(editor.state.doc.child(1).attrs.latex).toBe("mapped"); expect(editor.state.doc.firstChild?.textContent).toBe("协作插入");
  });
  it("selected node Enter and Mod+E open the editor; Escape cancels", () => {
    const anchor = host.querySelector<HTMLElement>(".organize-math-anchor")!;
    key(anchor, "Enter"); expect(document.querySelector("textarea")).not.toBeNull();
    key(document.querySelector("textarea")!, "Escape"); expect(document.querySelector("textarea")).toBeNull();
    key(anchor, "e", { metaKey: true }); expect(document.querySelector("textarea")).not.toBeNull();
  });
});
