// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";
import type { NodeViewProps } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mermaid, MermaidView } from "./mermaid-node";
import { MERMAID_PREVIEW_DEBOUNCE_MS, MermaidEditorDialog, showMermaidEditor } from "../mermaid-editor-dialog";
import { deleteSelectedMermaid, editSelectedMermaid } from "../mermaid-actions";
import { shouldShowTextToolbar } from "../block-interaction";
import { toast } from "@/hooks/use-toast";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, text: string) => {
    if (/boom/.test(text)) throw new Error("Parse error on line 2");
    return { svg: `<svg id="${id}"><text>${text.split("\n")[0]}</text></svg>` };
  }),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const extensions = [StarterKit, Mermaid];
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const CODE = "graph TD\n  A --> B";

describe("mermaid live-preview editor, selection toolbar and node view", () => {
  let editor: Editor, root: Root, host: HTMLDivElement;
  function render() {
    let pos: number | undefined;
    editor.state.doc.descendants((node, at) => { if (pos === undefined && node.type.name === "mermaid") pos = at; });
    root.render(<><MermaidEditorDialog editor={editor} />{pos !== undefined && <MermaidView {...{ editor, node: editor.state.doc.nodeAt(pos)!, getPos: () => pos, selected: editor.state.selection instanceof NodeSelection } as unknown as NodeViewProps} />}</>);
  }
  function button(name: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => (element.getAttribute("aria-label") || element.textContent) === name);
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  }
  function click(name: string) { act(() => button(name).click()); }
  function input(value: string) {
    const source = document.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(source, value); source.dispatchEvent(new Event("input", { bubbles: true })); });
    return source;
  }
  function key(element: Element, key: string, init: KeyboardEventInit = {}) { act(() => element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...init }))); }
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, MERMAID_PREVIEW_DEBOUNCE_MS + 60)); });
  const textarea = () => document.querySelector<HTMLTextAreaElement>("textarea");
  const previewRegion = () => document.querySelector<HTMLElement>('[aria-label="图表实时预览"]');
  const previewText = () => previewRegion()?.querySelector("svg text")?.textContent;
  const toolbar = () => document.querySelector<HTMLElement>('[aria-label="图表工具栏"]');
  const preview = () => host.querySelector<HTMLElement>(".organize-mermaid-preview")!;
  const mermaidPos = () => { let pos = -1; editor.state.doc.descendants((node, at) => { if (pos < 0 && node.type.name === "mermaid") pos = at; }); return pos; };
  /** PM 自己的双击判定入口（浏览器对可拖拽节点不合成 dblclick，所以不走 React onDoubleClick） */
  const doubleClick = (direct = true) => {
    let handled = false;
    act(() => {
      const pos = mermaidPos();
      handled = Boolean(editor.view.someProp("handleDoubleClickOn", (handler) => handler(editor.view, pos, editor.state.doc.nodeAt(pos)!, pos, new MouseEvent("mousedown"), direct)));
    });
    return handled;
  };
  const json = () => editor.getJSON();

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 300, bottom: 400, left: 20, right: 520, x: 20, y: 300, width: 500, height: 100, toJSON() {} });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    editor = new Editor({ extensions, editorProps: { handleScrollToSelection: () => true }, content: { type: "doc", content: [{ type: "mermaid", attrs: { code: CODE } }, p("正文")] } });
    editor.commands.setNodeSelection(0); editor.on("transaction", render); act(render);
    await flush();
  });
  afterEach(() => { editor.off("transaction", render); act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("renders the block, previews drafts live, keeps the last svg on syntax errors, and saves undoably", async () => {
    expect(host.querySelector(".organize-mermaid-preview svg text")?.textContent).toBe("graph TD");
    const before = json();
    click("编辑源码");
    expect(textarea()?.value).toBe(CODE);
    await flush();
    expect(previewText()).toBe("graph TD");
    input("flowchart LR\n  Alpha --> Beta"); await settle();
    expect(previewText()).toBe("flowchart LR");
    input("boom"); await settle();
    expect(previewRegion()?.getAttribute("data-invalid")).toBe("true");
    expect(document.body.textContent).toContain("图表语法有误");
    expect(document.body.textContent).toContain("Parse error on line 2");
    expect(document.body.textContent).toContain("首行似乎不是图表类型关键字");
    expect(previewText()).toBe("flowchart LR");
    input(""); await settle();
    expect(document.body.textContent).toContain("输入源码后在此预览");
    expect(document.querySelector('[data-invalid="true"]')).toBeNull();
    click("取消"); expect(textarea()).toBeNull(); expect(json()).toEqual(before);
    click("编辑源码"); const source = input("sequenceDiagram\n  A->>B: hi");
    key(source, "Enter", { ctrlKey: true, isComposing: true }); expect(textarea()).not.toBeNull();
    key(source, "Enter", { ctrlKey: true, keyCode: 229 }); expect(textarea()).not.toBeNull();
    key(source, "Enter"); expect(textarea()).not.toBeNull();
    key(source, "Enter", { metaKey: true }); expect(textarea()).toBeNull();
    expect(editor.state.doc.firstChild?.attrs.code).toBe("sequenceDiagram\n  A->>B: hi");
    await flush();
    expect(host.querySelector(".organize-mermaid-preview svg text")?.textContent).toBe("sequenceDiagram");
    act(() => { editor.commands.undo(); }); expect(json()).toEqual(before);
    click("编辑源码"); input(CODE); click("保存");
    expect(json()).toEqual(before);
    expect(editor.can().undo()).toBe(false);
  });

  it("selection toolbar copies with feedback, deletes undoably, and suppresses the text bubble", async () => {
    expect(toolbar()?.querySelectorAll("button")).toHaveLength(3);
    // 初次挂载即选中：锚点是包裹层本身，工具栏必须在同一轮就量到位置并可见（曾因父 ref 晚于子 layout effect 一直 hidden）
    expect(toolbar()?.style.visibility).toBe("visible");
    expect(toolbar()?.style.top).toBe("192px"); expect(toolbar()?.style.left).toBe("20px");
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    await act(async () => button("复制图表源码").click()); expect(copy).toHaveBeenCalledWith(CODE); expect(toast).toHaveBeenCalledWith({ title: "图表源码已复制" });
    copy.mockRejectedValueOnce(new Error("denied")); await act(async () => button("复制图表源码").click()); expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ variant: "destructive" }));
    await act(async () => button("复制源码").click()); expect(copy).toHaveBeenCalledTimes(3);
    expect(shouldShowTextToolbar({ editor, state: editor.state, view: editor.view, element: host, from: 0, to: 1 })).toBe(false);
    const before = json(); click("删除图表");
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph"); expect(toolbar()).toBeNull();
    act(() => { editor.commands.undo(); }); expect(json()).toEqual(before);
    key(toolbar()!, "Escape"); expect(document.activeElement).toBe(preview());
  });

  it("readonly leaves only copy entries; revoking permission closes the editor and rejects the pending save", async () => {
    const before = json();
    click("编辑源码"); input("changed"); const save = button("保存");
    act(() => editor.setEditable(false));
    expect(textarea()).toBeNull();
    act(() => save.click()); expect(json()).toEqual(before);
    expect([...host.querySelectorAll("button")].map((element) => element.textContent)).toEqual(["复制源码"]);
    expect(toolbar()?.querySelectorAll("button")).toHaveLength(1);
    expect(preview().getAttribute("aria-label")).toBe("选择 Mermaid 图表，复制源码");
    expect(doubleClick()).toBe(false); expect(textarea()).toBeNull();
    key(preview(), "Enter"); expect(textarea()).toBeNull();
    expect(editSelectedMermaid(editor)).toBe(false); expect(deleteSelectedMermaid(editor)).toBe(false);
    act(() => showMermaidEditor(editor, { code: "x", range: { from: 0, to: 1 }, onSave: () => {} })); expect(textarea()).toBeNull();
  });

  it("opens from the focused preview, double-click and the editor keymap; maps saves through edits; drops saves for deleted blocks", async () => {
    expect(preview().getAttribute("aria-label")).toBe("编辑 Mermaid 图表");
    key(preview(), "Enter"); expect(textarea()).not.toBeNull();
    key(textarea()!, "Escape"); expect(textarea()).toBeNull();
    key(preview(), "e", { metaKey: true }); expect(textarea()).not.toBeNull(); key(textarea()!, "Escape");
    expect(doubleClick(false)).toBe(false); expect(textarea()).toBeNull();
    expect(doubleClick()).toBe(true); expect(textarea()).not.toBeNull(); key(textarea()!, "Escape");
    act(() => { editor.commands.keyboardShortcut("Enter"); }); expect(textarea()).not.toBeNull(); key(textarea()!, "Escape");
    expect(editor.state.doc.childCount).toBe(2);
    act(() => { editor.commands.keyboardShortcut("Mod-e"); }); expect(textarea()).not.toBeNull();
    input("mapped"); act(() => { editor.commands.insertContentAt(0, p("协作插入")); }); click("保存");
    expect(editor.state.doc.child(1).attrs.code).toBe("mapped"); expect(editor.state.doc.firstChild?.textContent).toBe("协作插入");
    act(() => { editor.commands.setNodeSelection(mermaidPos()); });
    click("编辑图表"); input("orphan");
    const pos = mermaidPos(); act(() => { editor.commands.deleteRange({ from: pos, to: pos + 1 }); });
    click("保存"); expect(textarea()).toBeNull();
    expect(json().content?.some((node) => node.type === "mermaid")).toBe(false);
  });
});
