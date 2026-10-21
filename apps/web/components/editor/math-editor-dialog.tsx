"use client";

import type { Editor } from "@tiptap/core";
import type { SelectionBookmark, Transaction } from "@tiptap/pm/state";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { renderMath } from "./math-render";

type MathRange = { from: number; to: number };
interface MathRequest {
  isBlock: boolean;
  latex?: string;
  range?: MathRange;
  onSave?: (latex: string, range: MathRange) => void;
}
const EVENT = "organize:math-editor";

/** Editor-scoped event: nested editors and multiple notes never share dialog state. */
export function showMathEditor(editor: Editor, request: MathRequest) {
  if (!editor.isDestroyed && editor.isEditable) {
    editor.view.dom.dispatchEvent(new CustomEvent(EVENT, { detail: request }));
  }
}

export function MathEditorDialog({ editor }: { editor: Editor }) {
  const [request, setRequest] = useState<MathRequest | null>(null);
  const [latex, setLatex] = useState("");
  const pending = useRef<{ bookmark: SelectionBookmark; range: MathRange; deleted: boolean } | null>(null);
  const id = useId();
  const preview = useMemo(() => renderMath(latex, request?.isBlock ?? false, true), [latex, request?.isBlock]);
  useEffect(() => {
    const element = editor.view.dom;
    const open = (event: Event) => {
      if (!editor.isEditable) return;
      const next = (event as CustomEvent<MathRequest>).detail;
      pending.current = { bookmark: editor.state.selection.getBookmark(), range: next.range ?? { from: editor.state.selection.from, to: editor.state.selection.to }, deleted: false };
      setLatex(next.latex ?? "");
      setRequest(next);
    };
    const map = ({ transaction }: { transaction: Transaction }) => {
      if (!editor.isEditable) setRequest(null);
      const current = pending.current;
      if (!current || !transaction.docChanged) return;
      current.bookmark = current.bookmark.map(transaction.mapping);
      const from = transaction.mapping.mapResult(current.range.from, 1);
      const to = transaction.mapping.mapResult(current.range.to, -1);
      current.deleted ||= from.deletedAcross || (from.deleted && to.deleted);
      current.range = { from: from.pos, to: Math.max(from.pos, to.pos) };
    };
    const checkPermission = () => { if (!editor.isEditable) setRequest(null); };
    element.addEventListener(EVENT, open);
    editor.on("transaction", map);
    editor.on("update", checkPermission);
    return () => { element.removeEventListener(EVENT, open); editor.off("transaction", map); editor.off("update", checkPermission); pending.current = null; };
  }, [editor]);

  const save = () => {
    const current = pending.current;
    if (!request || !current || editor.isDestroyed || !editor.isEditable || current.deleted) { setRequest(null); return; }
    const { range, bookmark } = current;
    pending.current = null;
    editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)));
    if (request.onSave) request.onSave(latex, range);
    else if (request.isBlock) editor.commands.insertMathBlock(latex);
    else editor.commands.insertInlineMath(latex);
    setRequest(null);
  };

  return <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open) setRequest(null); }}>
    <DialogContent className="organize-math-dialog" onCloseAutoFocus={(event) => {
      event.preventDefault();
      if (!editor.isDestroyed) {
        const current = pending.current;
        pending.current = null;
        if (current) editor.view.dispatch(editor.state.tr.setSelection(current.bookmark.resolve(editor.state.doc)));
        editor.view.focus();
      }
    }}>
      <DialogHeader>
        <DialogTitle>{request?.latex === undefined ? "插入公式" : "编辑公式"}</DialogTitle>
        <DialogDescription id={`${id}-help`}>输入 LaTeX 查看实时预览，⌘/Ctrl + Enter 保存，Esc 取消。</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label htmlFor={id} className="text-sm font-medium">LaTeX 源码</label>
        <textarea id={id} autoFocus className="organize-math-source" value={latex} rows={5}
          placeholder="例如 E = mc^2" aria-describedby={`${id}-help${preview.error ? ` ${id}-error` : ""}`}
          onChange={(event) => setLatex(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) { event.stopPropagation(); return; }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
          }} />
        <div className="mt-4 text-sm font-medium">预览</div>
        <div className="organize-math-preview" role="region" aria-label="公式实时预览" data-invalid={preview.error}>
          {latex ? <span dangerouslySetInnerHTML={{ __html: preview.html }} /> : <span className="text-muted-foreground">输入公式后在此预览</span>}
        </div>
        {preview.error && <p id={`${id}-error`} role="status" className="mt-2 text-sm text-destructive">公式语法有误，请检查 LaTeX；仍可保存源码。</p>}
        <DialogFooter className="mt-4 gap-2"><Button type="button" variant="outline" onClick={() => setRequest(null)}>取消</Button><Button type="submit">保存</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
