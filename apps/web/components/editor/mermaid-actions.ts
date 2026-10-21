import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { toast } from "@/hooks/use-toast";
import { DEFAULT_MERMAID_CODE } from "./extensions/mermaid";
import { showMermaidEditor } from "./mermaid-editor-dialog";

function selectedMermaid(editor: Editor): NodeSelection | null {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === "mermaid" ? selection : null;
}

/**
 * 打开 `pos` 处图表的实时预览编辑浮层。保存回调拿到的是经 transaction 映射后的位置，
 * 写回前重新核对节点类型与权限；只在源码确有变化时产生一条可撤销事务。
 */
export function editMermaidAt(editor: Editor, pos: number): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "mermaid") return false;
  const current = selectedMermaid(editor);
  if (!current || current.from !== pos) editor.commands.setNodeSelection(pos);
  showMermaidEditor(editor, {
    code: String(node.attrs.code || DEFAULT_MERMAID_CODE),
    range: { from: pos, to: pos + node.nodeSize },
    onSave: (code, range) => {
      if (editor.isDestroyed || !editor.isEditable) return;
      const target = editor.state.doc.nodeAt(range.from);
      if (!target || target.type.name !== "mermaid" || target.attrs.code === code) return;
      editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(range.from, undefined, { ...target.attrs, code }));
    },
  });
  return true;
}

export function editSelectedMermaid(editor: Editor): boolean {
  const selection = selectedMermaid(editor);
  return selection ? editMermaidAt(editor, selection.from) : false;
}

export function deleteSelectedMermaid(editor: Editor): boolean {
  if (!editor.isEditable || !selectedMermaid(editor)) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).deleteSelection().scrollIntoView());
  editor.view.focus();
  return true;
}

export async function copyMermaidSource(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    toast({ title: "图表源码已复制" });
    return true;
  } catch {
    toast({ title: "图表源码复制失败，请重试", variant: "destructive" });
    return false;
  }
}
