"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { convertSelectedMath, deleteSelectedMath } from "./math-actions";

export function MathToolbar({ editor, anchor, isBlock, latex, onEdit }: {
  editor: Editor; anchor: RefObject<HTMLElement>; isBlock: boolean; latex: string; onEdit: () => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const node = anchor.current, bar = toolbar.current;
    if (!node || !bar) return;
    const update = () => {
      const rect = node.getBoundingClientRect(), size = bar.getBoundingClientRect();
      setVisible(rect.bottom > 0 && rect.top < window.innerHeight);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - size.width - 8)), top: Math.max(8, Math.min(rect.top - size.height - 8, window.innerHeight - size.height - 8)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node); observer.observe(bar);
    window.addEventListener("scroll", update, true); window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [anchor]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(latex); toast({ title: "公式源码已复制" }); }
    catch { toast({ title: "公式源码复制失败，请重试", variant: "destructive" }); }
  };
  return createPortal(<div ref={toolbar} className="organize-math-toolbar" role="group" aria-label="公式工具栏"
    style={{ ...position, visibility: visible ? "visible" : "hidden" }}
    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); anchor.current?.focus(); } }}>
    {editor.isEditable && <Button variant="ghost" size="sm" aria-label="编辑公式" onClick={onEdit}>编辑</Button>}
    <Button variant="ghost" size="sm" aria-label="复制 LaTeX" onClick={() => void copy()}>复制 LaTeX</Button>
    {editor.isEditable && <>
      <Button variant="ghost" size="sm" aria-label={isBlock ? "转为行内公式" : "转为公式区块"} onClick={() => convertSelectedMath(editor)}>{isBlock ? "转为行内" : "转为区块"}</Button>
      <Button variant="ghost" size="sm" className="text-destructive" aria-label="删除公式" onClick={() => deleteSelectedMath(editor)}>删除</Button>
    </>}
  </div>, document.body);
}
