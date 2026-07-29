import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const MIN_COLUMN_COUNT = 2;
export const MAX_COLUMN_COUNT = 5;
export const MIN_COLUMN_WIDTH = 10;

export function normalizeColumnCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MIN_COLUMN_COUNT;
  return Math.min(MAX_COLUMN_COUNT, Math.max(MIN_COLUMN_COUNT, Math.round(parsed)));
}

function equalColumnWidths(cols: number): number[] {
  return Array.from({ length: cols }, () => 100 / cols);
}

export function normalizeColumnWidths(value: unknown, columnCount: unknown): number[] {
  const cols = normalizeColumnCount(columnCount);
  if (
    !Array.isArray(value)
    || value.length !== cols
    || value.some((entry) => !Number.isFinite(Number(entry)) || Number(entry) <= 0)
  ) {
    return equalColumnWidths(cols);
  }

  const raw = value.map(Number);
  const sum = raw.reduce((total, width) => total + width, 0);
  const normalized = raw.map((width) => (width / sum) * 100);
  const result = normalized.map((width) => Math.max(MIN_COLUMN_WIDTH, width));
  const excess = result.reduce((total, width) => total + width, 0) - 100;

  if (excess > 0) {
    const available = result.reduce(
      (total, width) => total + Math.max(0, width - MIN_COLUMN_WIDTH),
      0
    );
    if (available <= 0) return equalColumnWidths(cols);
    for (let index = 0; index < result.length; index += 1) {
      const room = Math.max(0, result[index] - MIN_COLUMN_WIDTH);
      result[index] -= excess * (room / available);
    }
  }

  const rounded = result.map((width) => Number(width.toFixed(4)));
  const correction = Number((100 - rounded.reduce((total, width) => total + width, 0)).toFixed(4));
  const widestIndex = rounded.indexOf(Math.max(...rounded));
  rounded[widestIndex] = Number((rounded[widestIndex] + correction).toFixed(4));
  return rounded;
}

export function resizeColumnWidths(
  value: unknown,
  columnCount: unknown,
  dividerIndex: number,
  deltaPercent: number
): number[] {
  const widths = normalizeColumnWidths(value, columnCount);
  if (
    dividerIndex < 0
    || dividerIndex >= widths.length - 1
    || !Number.isFinite(deltaPercent)
  ) {
    return widths;
  }

  const pairWidth = widths[dividerIndex] + widths[dividerIndex + 1];
  const nextLeft = Math.min(
    pairWidth - MIN_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, widths[dividerIndex] + deltaPercent)
  );
  widths[dividerIndex] = nextLeft;
  widths[dividerIndex + 1] = pairWidth - nextLeft;
  return normalizeColumnWidths(widths, widths.length);
}

function serializeColumnWidths(widths: number[]): string {
  return widths.map((width) => Number(width.toFixed(4))).join(",");
}

function parseColumnWidths(element: HTMLElement): number[] | null {
  const raw = element.getAttribute("data-column-widths");
  if (!raw) return null;
  const widths = raw.split(",").map(Number);
  return widths.every(Number.isFinite) ? widths : null;
}

function ColumnsView({ node, updateAttributes, editor }: NodeViewProps) {
  const cols = normalizeColumnCount(node.childCount || node.attrs.cols);
  const widths = useMemo(
    () => normalizeColumnWidths(node.attrs.widths, cols),
    [cols, node.attrs.widths]
  );
  const layoutRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    dividerIndex: number;
    startX: number;
    startWidths: number[];
    layoutWidth: number;
  } | null>(null);
  const [activeDivider, setActiveDivider] = useState<number | null>(null);

  const gridTemplate = useMemo(
    () => widths
      .flatMap((width, index) => (
        index === widths.length - 1
          ? [`${width}fr`]
          : [`${width}fr`, "var(--organize-columns-gap)"]
      ))
      .join(" "),
    [widths]
  );

  const applyResize = useCallback((dividerIndex: number, deltaPercent: number) => {
    updateAttributes({
      cols,
      widths: resizeColumnWidths(widths, cols, dividerIndex, deltaPercent),
    });
  }, [cols, updateAttributes, widths]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const deltaPercent = ((event.clientX - drag.startX) / drag.layoutWidth) * 100;
      updateAttributes({
        cols,
        widths: resizeColumnWidths(
          drag.startWidths,
          cols,
          drag.dividerIndex,
          deltaPercent
        ),
      });
    };
    const finishPointerDrag = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setActiveDivider(null);
      editor.commands.focus();
    };
    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", finishPointerDrag, true);
    window.addEventListener("pointercancel", finishPointerDrag, true);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", finishPointerDrag, true);
      window.removeEventListener("pointercancel", finishPointerDrag, true);
    };
  }, [cols, editor, updateAttributes]);

  const minWidth = cols * 92 + (cols - 1) * 24;

  return (
    <NodeViewWrapper
      as="div"
      className="organize-columns"
      data-columns=""
      data-cols={cols}
      data-column-widths={serializeColumnWidths(widths)}
    >
      <div
        ref={layoutRef}
        className="organize-columns-layout"
        style={{ minWidth }}
      >
        <NodeViewContent
          as="div"
          className="organize-columns-content"
          style={{ gridTemplateColumns: gridTemplate }}
        />
        <div
          className="organize-column-resizers"
          style={{ gridTemplateColumns: gridTemplate }}
          contentEditable={false}
        >
          {Array.from({ length: cols - 1 }, (_, dividerIndex) => (
            <div
              key={dividerIndex}
              className="organize-column-resizer"
              data-active={activeDivider === dividerIndex ? "true" : "false"}
              role="separator"
              aria-orientation="vertical"
              aria-label={`调整第 ${dividerIndex + 1} 列和第 ${dividerIndex + 2} 列宽度`}
              aria-valuemin={MIN_COLUMN_WIDTH}
              aria-valuemax={Math.round(
                widths[dividerIndex] + widths[dividerIndex + 1] - MIN_COLUMN_WIDTH
              )}
              aria-valuenow={Math.round(widths[dividerIndex])}
              tabIndex={editor.isEditable ? 0 : -1}
              style={{ gridColumn: dividerIndex * 2 + 2 }}
              onPointerDown={(event) => {
                if (!editor.isEditable || event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                const layoutWidth = layoutRef.current?.getBoundingClientRect().width || 0;
                if (!layoutWidth) return;
                dragRef.current = {
                  dividerIndex,
                  startX: event.clientX,
                  startWidths: widths,
                  layoutWidth,
                };
                setActiveDivider(dividerIndex);
              }}
              onKeyDown={(event) => {
                const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
                if (!direction) return;
                event.preventDefault();
                event.stopPropagation();
                applyResize(dividerIndex, direction * (event.shiftKey ? 5 : 2));
              }}
            >
              <span aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (cols: number) => ReturnType;
    };
  }
}

export const Column = Node.create({
  name: "column",
  group: "column",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "" }), 0];
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,

  addAttributes() {
    return {
      cols: {
        default: 2,
        parseHTML: (element) => normalizeColumnCount(
          (element as HTMLElement).getAttribute("data-cols")
        ),
        renderHTML: (attributes) => ({
          "data-cols": String(normalizeColumnCount(attributes.cols)),
        }),
      },
      widths: {
        default: null,
        parseHTML: (element) => parseColumnWidths(element as HTMLElement),
        renderHTML: (attributes) => {
          if (!Array.isArray(attributes.widths)) return {};
          const widths = normalizeColumnWidths(attributes.widths, attributes.cols);
          return { "data-column-widths": serializeColumnWidths(widths) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const cols = normalizeColumnCount(node.childCount || node.attrs.cols);
    const widths = normalizeColumnWidths(node.attrs.widths, cols);
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-columns": "",
        "data-cols": String(cols),
        "data-column-widths": serializeColumnWidths(widths),
        style: `display:grid;grid-template-columns:${widths.map((width) => `${width}fr`).join(" ")};gap:1.5rem;`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsView);
  },

  addCommands() {
    return {
      insertColumns:
        (cols: number) =>
        ({ commands }) => {
          const columnCount = normalizeColumnCount(cols);
          const widths = equalColumnWidths(columnCount);
          return commands.insertContent({
            type: this.name,
            attrs: { cols: columnCount, widths },
            content: Array.from({ length: columnCount }, () => ({
              type: "column",
              content: [{ type: "paragraph" }],
            })),
          });
        },
    };
  },
});

export default Columns;
