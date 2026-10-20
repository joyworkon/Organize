import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { closeHistory } from "@tiptap/pm/history";
import { ImageToolbar } from "../image-toolbar";
import { ImageViewer } from "@/components/ui/image-viewer";
import { useEditorUpload } from "../use-editor-upload";
import { clampWidth, draggedWidth, keyboardWidth, MIN_IMAGE_WIDTH } from "../image-geometry";

function normalizeWidth(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

export function ResizableImageView({ node, editor, getPos, selected }: NodeViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; width: number; side: "left" | "right"; live: number | null } | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [maximum, setMaximum] = useState(760);
  const [editable, setEditable] = useState(editor.isEditable);
  const [focused, setFocused] = useState(false);
  const [viewing, setViewing] = useState(false);
  const { uploadImage } = useEditorUpload(editor);
  const width = liveWidth ?? normalizeWidth(node.attrs.width);
  useEffect(() => {
    const update = () => {
      setEditable(editor.isEditable);
      if (!editor.isEditable) { drag.current = null; setLiveWidth(null); }
    };
    editor.on("transaction", update);
    editor.on("update", update);
    return () => { editor.off("transaction", update); editor.off("update", update); };
  }, [editor]);
  useEffect(() => {
    const parent = frameRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setMaximum(Math.max(1, Math.floor(parent.getBoundingClientRect().width || editor.view.dom.getBoundingClientRect().width || 760)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [editor]);

  // Resolve this NodeView's current position at commit time. No stale selection, blockId or save-path changes.
  const target = () => {
    if (editor.isDestroyed || !editor.isEditable) return null;
    const pos = getPos();
    if (typeof pos !== "number") return null;
    const current = editor.state.doc.nodeAt(pos);
    return current?.type.name === "image" ? { pos, current } : null;
  };
  const change = (attrs: Record<string, unknown>, expectedSrc?: string) => {
    const found = target();
    if (!found || (expectedSrc !== undefined && found.current.attrs.src !== expectedSrc)) return;
    editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(found.pos, undefined, { ...found.current.attrs, ...attrs }));
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const select = () => {
    if (editor.isDestroyed) return;
    const pos = getPos();
    if (typeof pos === "number") editor.commands.setNodeSelection(pos);
  };
  const restoreFocus = () => { frameRef.current?.focus({ preventScroll: true }); };
  // NodeView controls and portals sit outside ProseMirror's normal key event path.
  // Forward to the existing keymap so undo/redo/delete keep their editor semantics.
  const editorKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("input, textarea, select") || !editor.isEditable) return;
    if (editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event.nativeEvent))) {
      event.preventDefault(); event.stopPropagation();
    }
  };
  const endResize = (event: React.PointerEvent<HTMLSpanElement>, cancel = false) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!cancel && current.live !== null) change({ width: current.live });
    setLiveWidth(null);
  };
  return <NodeViewWrapper className="organize-image" data-resizing={liveWidth !== null ? "true" : undefined}>
    <div ref={frameRef} className="organize-image-frame" style={width ? { width: `${width}px` } : undefined}
      tabIndex={0} role="group" aria-label="图片块" contentEditable={false}
      onFocus={() => { setFocused(true); select(); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}
      onClick={(event) => { if (event.target instanceof HTMLImageElement) { select(); if (!editor.isEditable) setViewing(true); } }}
      onDoubleClick={(event) => { if (event.target instanceof HTMLImageElement) setViewing(true); }}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setViewing(true); } else editorKeyDown(event); }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Editor images keep their existing resize DOM. */}
      <img src={node.attrs.src as string} alt={(node.attrs.alt as string) || ""} title={(node.attrs.title as string) || undefined} draggable={false} />
      {editable && (selected || focused || liveWidth !== null) && (["left", "right"] as const).map((side) => <span key={side}
        className="organize-image-resizer" data-side={side} contentEditable={false} role="separator" tabIndex={0}
        aria-orientation="vertical" aria-label={`${side === "left" ? "左" : "右"}侧调整图片宽度`}
        aria-valuemin={Math.min(MIN_IMAGE_WIDTH, maximum)} aria-valuemax={maximum} aria-valuenow={clampWidth(width ?? frameRef.current?.getBoundingClientRect().width ?? maximum, maximum)}
        title="左右方向键调整 16px，Shift 调整 64px，Home 最小，End 最大"
        onKeyDown={(event) => {
          if (!editor.isEditable) return;
          const next = keyboardWidth(width ?? frameRef.current?.getBoundingClientRect().width ?? maximum, event.key, event.shiftKey, maximum);
          if (next === null) return;
          event.preventDefault(); event.stopPropagation(); change({ width: next });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !editor.isEditable) return;
          event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
          drag.current = { pointerId: event.pointerId, startX: event.clientX, width: frameRef.current?.getBoundingClientRect().width || width || maximum, side, live: null };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId || !editor.isEditable) return;
          current.live = draggedWidth(current.width, event.clientX - current.startX, current.side, maximum);
          setLiveWidth(current.live);
        }}
        onPointerUp={(event) => endResize(event)} onPointerCancel={(event) => endResize(event, true)} onLostPointerCapture={(event) => endResize(event, true)} />)}
      {liveWidth !== null && <output className="organize-image-size" contentEditable={false}>{Math.round(liveWidth / maximum * 100)}% · {liveWidth}px</output>}
    </div>
    {(selected || focused) && !viewing && <ImageToolbar anchor={frameRef} editable={editable} width={normalizeWidth(node.attrs.width)} maximum={maximum}
      alt={(node.attrs.alt as string) || ""} src={node.attrs.src as string} onChange={change}
      onReplace={() => { const src = node.attrs.src as string; uploadImage(undefined, undefined, undefined, (next) => change({ src: next }, src)); }}
      onDelete={() => { const found = target(); if (found) { editor.view.dispatch(closeHistory(editor.state.tr).delete(found.pos, found.pos + found.current.nodeSize)); editor.view.dispatch(closeHistory(editor.state.tr)); editor.view.focus(); } }}
      onView={() => setViewing(true)} onEditorKeyDown={editorKeyDown} />}
    {viewing && <ImageViewer src={node.attrs.src as string} alt={(node.attrs.alt as string) || ""} onClose={() => setViewing(false)} returnFocus={restoreFocus} />}
  </NodeViewWrapper>;
}

/** Image schema intentionally unchanged: adding default-null align would change legacy getJSON(). */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) =>
          normalizeWidth(
            element.getAttribute("data-width") ?? (element as HTMLElement).style.width
          ),
        renderHTML: (attributes) => {
          const width = normalizeWidth(attributes.width);
          return width === null
            ? {}
            : { "data-width": String(width), style: `width: ${width}px` };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

export default ResizableImage;
