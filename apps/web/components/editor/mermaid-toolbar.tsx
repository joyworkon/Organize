"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { copyMermaidSource, deleteSelectedMermaid } from "./mermaid-actions";

/**
 * 图表块选中时的浮动工具栏：与公式 / 图片 / 代码块同一套做法——portal 到 body、fixed 定位到块上方、
 * 跟随滚动与尺寸变化；容器 mousedown 阻止默认行为，点按钮不会让编辑器失焦。只读只保留「复制源码」。
 * 锚点直接传元素（而非 ref）：调用方等包裹层挂好再渲染本组件，首帧就能量到真实位置。
 */
export function MermaidToolbar({ editor, anchor, code, onEdit, onEscape }: {
  editor: Editor;
  anchor: HTMLElement;
  code: string;
  onEdit: () => void;
  /** Esc 把焦点交回块 */
  onEscape: () => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const bar = toolbar.current;
    if (!bar) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect(), size = bar.getBoundingClientRect();
      setVisible(rect.bottom > 0 && rect.top < window.innerHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - size.width - 8)),
        top: Math.max(8, Math.min(rect.top - size.height - 8, window.innerHeight - size.height - 8)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor); observer.observe(bar);
    window.addEventListener("scroll", update, true); window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [anchor]);
  return createPortal(<div ref={toolbar} className="organize-mermaid-selection-toolbar" role="group" aria-label="图表工具栏"
    style={{ ...position, visibility: visible ? "visible" : "hidden" }}
    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onEscape(); } }}>
    {editor.isEditable && <Button variant="ghost" size="sm" aria-label="编辑图表" onClick={onEdit}>编辑</Button>}
    <Button variant="ghost" size="sm" aria-label="复制图表源码" onClick={() => void copyMermaidSource(code)}>复制源码</Button>
    {editor.isEditable && <Button variant="ghost" size="sm" className="text-destructive" aria-label="删除图表" onClick={() => deleteSelectedMermaid(editor)}>删除</Button>}
  </div>, document.body);
}
