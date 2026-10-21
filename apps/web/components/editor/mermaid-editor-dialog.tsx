"use client";

import type { Editor } from "@tiptap/core";
import type { SelectionBookmark, Transaction } from "@tiptap/pm/state";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { looksLikeMermaid } from "./extensions/mermaid";
import { useMermaidPreview } from "./use-mermaid-preview";

type MermaidRange = { from: number; to: number };
export interface MermaidEditorRequest {
  code: string;
  range: MermaidRange;
  onSave: (code: string, range: MermaidRange) => void;
}
const EVENT = "organize:mermaid-editor";
/** 草稿变化到重渲的节流；任务要求 ≤300ms */
export const MERMAID_PREVIEW_DEBOUNCE_MS = 250;

/** 与公式浮层同一套合同：事件只在本编辑器的 DOM 上派发，嵌套编辑器 / 多篇笔记互不串台。 */
export function showMermaidEditor(editor: Editor, request: MermaidEditorRequest) {
  if (!editor.isDestroyed && editor.isEditable) {
    editor.view.dom.dispatchEvent(new CustomEvent(EVENT, { detail: request }));
  }
}

export function MermaidEditorDialog({ editor }: { editor: Editor }) {
  const [request, setRequest] = useState<MermaidEditorRequest | null>(null);
  const [draft, setDraft] = useState("");
  const pending = useRef<{ bookmark: SelectionBookmark; range: MermaidRange; deleted: boolean } | null>(null);
  const id = useId();
  const open = request !== null;
  // 打开时先立即渲染原图，之后的修改才节流
  const preview = useMermaidPreview(draft, { debounceMs: request && draft !== request.code ? MERMAID_PREVIEW_DEBOUNCE_MS : 0, enabled: open, keepLastSvg: true });

  useEffect(() => {
    const element = editor.view.dom;
    const openEditor = (event: Event) => {
      if (!editor.isEditable) return;
      const next = (event as CustomEvent<MermaidEditorRequest>).detail;
      pending.current = { bookmark: editor.state.selection.getBookmark(), range: next.range, deleted: false };
      setDraft(next.code);
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
    element.addEventListener(EVENT, openEditor);
    editor.on("transaction", map);
    editor.on("update", checkPermission);
    return () => {
      element.removeEventListener(EVENT, openEditor);
      editor.off("transaction", map);
      editor.off("update", checkPermission);
      pending.current = null;
    };
  }, [editor]);

  const close = () => setRequest(null);
  const save = () => {
    const current = pending.current;
    if (!request || !current || editor.isDestroyed || !editor.isEditable || current.deleted) { close(); return; }
    pending.current = null;
    editor.view.dispatch(editor.state.tr.setSelection(current.bookmark.resolve(editor.state.doc)));
    request.onSave(draft, current.range);
    close();
  };

  const hasDraft = draft.trim().length > 0;
  const showHint = hasDraft && !looksLikeMermaid(draft);
  const describedBy = [`${id}-help`, showHint ? `${id}-hint` : "", preview.error ? `${id}-error` : ""].filter(Boolean).join(" ");

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent className="organize-mermaid-dialog" onCloseAutoFocus={(event) => {
      event.preventDefault();
      if (!editor.isDestroyed) {
        const current = pending.current;
        pending.current = null;
        if (current) editor.view.dispatch(editor.state.tr.setSelection(current.bookmark.resolve(editor.state.doc)));
        editor.view.focus();
      }
    }}>
      <DialogHeader>
        <DialogTitle>编辑 Mermaid 图表</DialogTitle>
        <DialogDescription id={`${id}-help`}>修改源码即时预览，⌘/Ctrl + Enter 保存，Esc 取消；支持 flowchart / sequence / class / state / gantt / pie 等。</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <div className="organize-mermaid-dialog-body">
          <div className="min-w-0">
            <label htmlFor={id} className="text-sm font-medium">Mermaid 源码</label>
            <textarea id={id} autoFocus className="organize-mermaid-source" value={draft} spellCheck={false}
              placeholder={"例如\ngraph LR\n  A --> B"} aria-describedby={describedBy}
              onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
                if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) { event.stopPropagation(); return; }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
              }} />
            {showHint && <p id={`${id}-hint`} role="status" className="organize-mermaid-warn mt-2 text-sm">提示：首行似乎不是图表类型关键字（如 graph、flowchart、sequenceDiagram）。</p>}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">预览</div>
            <div className="organize-mermaid-dialog-preview" role="region" aria-label="图表实时预览" data-invalid={Boolean(preview.error)}>
              {preview.svg
                ? <div dangerouslySetInnerHTML={{ __html: preview.svg }} />
                : preview.error
                  ? <pre className="organize-mermaid-dialog-fallback">{draft}</pre>
                  : <span className="text-muted-foreground">{hasDraft ? "正在渲染图表…" : "输入源码后在此预览"}</span>}
            </div>
            {preview.error && <p id={`${id}-error`} role="status" className="mt-2 text-sm text-destructive">
              图表语法有误，请检查源码；仍可保存。
              <span className="organize-mermaid-dialog-error-detail">{preview.error}</span>
            </p>}
          </div>
        </div>
        <DialogFooter className="mt-4 gap-2">
          <Button type="button" variant="outline" onClick={close}>取消</Button>
          <Button type="submit">保存</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
