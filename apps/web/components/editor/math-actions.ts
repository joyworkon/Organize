import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";

export function convertSelectedMath(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!editor.isEditable || !(selection instanceof NodeSelection)) return false;
  const { node, from, to } = selection;
  if (node.type.name !== "inlineMath" && node.type.name !== "mathBlock") return false;
  const isBlock = node.type.name === "mathBlock";
  const parent = selection.$from.parent;
  const attrs = !isBlock && parent.isTextblock && parent.childCount === 1
    ? { ...parent.attrs, ...node.attrs } : node.attrs;
  const replacement = editor.schema.nodes[isBlock ? "inlineMath" : "mathBlock"].create(attrs);
  const tr = closeHistory(editor.state.tr);
  // A block becomes its own paragraph; fitting an inline→block replacement splits
  // the textblock while retaining text/marks on both sides (also inside lists).
  tr.replaceRangeWith(from, to, isBlock ? editor.schema.nodes.paragraph.create(node.attrs, replacement) : replacement);
  let pos: number | undefined;
  tr.doc.descendants((child, childPos) => { if (child === replacement) pos = childPos; });
  if (pos === undefined) return false;
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

export function deleteSelectedMath(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!editor.isEditable || !(selection instanceof NodeSelection) || !["inlineMath", "mathBlock"].includes(selection.node.type.name)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).deleteSelection().scrollIntoView());
  editor.view.focus();
  return true;
}
