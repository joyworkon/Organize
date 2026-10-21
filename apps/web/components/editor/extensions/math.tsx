"use client";

import { Node, Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { showMathEditor } from "../math-editor-dialog";
import { MathToolbar } from "../math-toolbar";
import { renderMath } from "../math-render";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";

/** Existing JSON/HTML contracts remain inlineMath/mathBlock + latex. */
export function MathNodeView({ node, editor, getPos, selected }: NodeViewProps) {
  const isBlock = node.type.name === "mathBlock";
  const latex = (node.attrs.latex as string) || "";
  const anchor = useRef<HTMLElement>(null);
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    editor.on("transaction", update);
    editor.on("update", update);
    return () => { editor.off("transaction", update); editor.off("update", update); };
  }, [editor]);
  const select = () => {
    const pos = getPos();
    if (typeof pos === "number") editor.commands.setNodeSelection(pos);
  };
  const edit = () => {
    if (!editor.isEditable) return;
    select();
    const pos = getPos();
    if (typeof pos !== "number") return;
    showMathEditor(editor, { isBlock, latex, range: { from: pos, to: pos + node.nodeSize }, onSave: (next, range) => {
      if (!editor.isEditable || editor.state.doc.nodeAt(range.from)?.type !== node.type) return;
      const current = editor.state.doc.nodeAt(range.from)!;
      if (current.attrs.latex !== next) editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(range.from, undefined, { ...current.attrs, latex: next }));
    } });
  };
  const html = useMemo(() => renderMath(latex, isBlock).html, [latex, isBlock]);
  return <NodeViewWrapper as={isBlock ? "div" : "span"} className={`${isBlock ? "math-block" : "math-inline"}${selected ? " ProseMirror-selectednode" : ""}`}
    contentEditable={false} data-math-block={isBlock ? "" : undefined} data-math-inline={!isBlock ? "" : undefined} data-latex={latex}>
    <span ref={anchor} className="organize-math-anchor" tabIndex={0} role="button"
      aria-label={editor.isEditable ? "编辑公式" : "选择公式，复制 LaTeX"} aria-haspopup={editor.isEditable ? "dialog" : undefined}
      onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={() => { select(); if (editor.isEditable) edit(); }} onFocus={select}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e")) { event.preventDefault(); event.stopPropagation(); edit(); }
        if (event.key === " ") { event.preventDefault(); select(); }
      }}>
      {latex ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="text-muted-foreground">空公式</span>}
    </span>
    {selected && <MathToolbar editor={editor} anchor={anchor} isBlock={isBlock} latex={latex} onEdit={edit} />}
  </NodeViewWrapper>;
}

function createMathNode(name: string, isBlock: boolean) {
  return Node.create({
    name,
    group: isBlock ? "block" : "inline",
    inline: !isBlock,
    atom: true,
    selectable: true,

    addAttributes() {
      return {
        latex: {
          default: "",
          parseHTML: (el) => (el as HTMLElement).getAttribute("data-latex") || "",
        },
      };
    },

    parseHTML() {
      return [{ tag: `${isBlock ? "div" : "span"}[data-${isBlock ? "math-block" : "math-inline"}]` }];
    },

    renderHTML({ HTMLAttributes, node }) {
      const rendered = renderMath((node.attrs.latex as string) || "", isBlock).html;
      const wrapper = document.createElement(isBlock ? "div" : "span");
      wrapper.setAttribute(`data-${isBlock ? "math-block" : "math-inline"}`, "");
      wrapper.setAttribute("data-latex", (node.attrs.latex as string) || "");
      wrapper.innerHTML = rendered;
      return wrapper;
    },

    addNodeView() {
      return ReactNodeViewRenderer(MathNodeView);
    },
  });
}

export const InlineMath = createMathNode("inlineMath", false);
export const MathBlock = createMathNode("mathBlock", true);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    math: {
      insertInlineMath: (latex: string) => ReturnType;
      insertMathBlock: (latex: string) => ReturnType;
    };
  }
}

export const MathCommands = Extension.create({
  name: "mathCommands",

  priority: 200,

  addKeyboardShortcuts() {
    const edit = () => {
      const { selection } = this.editor.state;
      if (!this.editor.isEditable || !(selection instanceof NodeSelection) || !["inlineMath", "mathBlock"].includes(selection.node.type.name)) return false;
      const element = this.editor.view.nodeDOM(selection.from) as HTMLElement | null;
      element?.querySelector<HTMLElement>(".organize-math-anchor")?.click();
      return true;
    };
    return { Enter: edit, "Mod-e": edit };
  },

  addCommands() {
    return {
      insertInlineMath:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: "inlineMath", attrs: { latex } }),
      insertMathBlock:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: "mathBlock", attrs: { latex } }),
    };
  },
});
