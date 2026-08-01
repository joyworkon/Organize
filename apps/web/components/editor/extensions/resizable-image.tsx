import Image from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useCallback, useRef, useState } from "react";

const MIN_WIDTH = 96;

function normalizeWidth(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

interface WidthDrag {
  pointerId: number;
  startX: number;
  startWidth: number;
}

function ResizableImageView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<WidthDrag | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const width = liveWidth ?? normalizeWidth(node.attrs.width);

  const maxWidth = useCallback(() => {
    const editorWidth = editor.view.dom.getBoundingClientRect().width;
    return Math.max(MIN_WIDTH, Math.floor(editorWidth));
  }, [editor]);

  const beginResize = useCallback((event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startWidth = frameRef.current?.getBoundingClientRect().width ?? 0;
    if (!startWidth) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const moveResize = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const next = Math.round(
        Math.min(maxWidth(), Math.max(MIN_WIDTH, drag.startWidth + event.clientX - drag.startX))
      );
      setLiveWidth(next);
    },
    [maxWidth]
  );

  const endResize = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setLiveWidth((current) => {
        if (current !== null) updateAttributes({ width: current });
        return null;
      });
    },
    [updateAttributes]
  );

  const resetWidth = useCallback(() => {
    updateAttributes({ width: null });
  }, [updateAttributes]);

  return (
    <NodeViewWrapper
      className="organize-image"
      data-resizing={liveWidth !== null ? "true" : undefined}
    >
      <div
        ref={frameRef}
        className="organize-image-frame"
        style={width ? { width: `${width}px` } : undefined}
        onDoubleClick={resetWidth}
        title={width ? "双击恢复自适应宽度" : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 编辑器内图片宽度由手柄手动控制，<Image> 的尺寸优化与此冲突 */}
        <img
          src={node.attrs.src as string}
          alt={(node.attrs.alt as string) || ""}
          title={(node.attrs.title as string) || undefined}
          draggable={false}
        />
        {(selected || liveWidth !== null) && (
          <span
            className="organize-image-resizer"
            contentEditable={false}
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整图片宽度"
            title="拖动调整宽度，双击图片恢复自适应宽度"
            onPointerDown={beginResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}

/**
 * 可拖拽调整宽度的图片：在原 Image 扩展上增加 width 属性（px），
 * 选中图片后拖动右缘手柄调整；双击恢复自适应宽度。
 */
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
