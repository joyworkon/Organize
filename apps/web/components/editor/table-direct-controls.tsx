"use client";

import type { Editor } from "@tiptap/core";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import {
  GripHorizontal,
  GripVertical,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  deleteTableColumnAt,
  deleteTableRowAt,
  getActiveTable,
  insertTableColumnAt,
  insertTableRowAt,
  moveActiveTableColumn,
  moveActiveTableRow,
  selectTableColumn,
  selectTableRow,
  selectWholeTable,
  setTableRowHeight,
  tableHasMergedCells,
} from "./extensions/table-style";

type TableAxis = "table" | "row" | "column";

interface AxisTarget {
  axis: TableAxis;
  index: number;
}

interface AxisRect {
  start: number;
  size: number;
}

interface TableGeometry {
  tablePos: number;
  left: number;
  top: number;
  width: number;
  height: number;
  visibleLeft: number;
  visibleTop: number;
  visibleRight: number;
  visibleBottom: number;
  rows: AxisRect[];
  columns: AxisRect[];
  hasMergedCells: boolean;
}

interface AxisDrag {
  pointerId: number;
  tablePos: number;
  axis: Exclude<TableAxis, "table">;
  from: number;
  startX: number;
  startY: number;
  active: boolean;
  captureElement: HTMLButtonElement;
}

interface DragVisual {
  axis: Exclude<TableAxis, "table">;
  from: number;
  boundary: number;
  clientX: number;
  clientY: number;
}

interface RowResize {
  pointerId: number;
  tablePos: number;
  row: number;
  startY: number;
  startHeight: number;
  height: number;
  tableElement: HTMLTableElement;
  previewClass: string;
  previewStyle: HTMLStyleElement;
  captureElement: HTMLButtonElement;
}

const DRAG_THRESHOLD = 4;
const MIN_ROW_HEIGHT = 32;
const CONTROL_CLIP_GUTTER = 80;
const AXIS_GRIP_SIZE = 16;
const CORNER_HANDLE_SIZE = 18;
const BOUNDARY_ADD_OFFSET = 22;
let rowResizePreviewId = 0;

function targetEquals(left: AxisTarget | null, right: AxisTarget | null) {
  return left?.axis === right?.axis && left?.index === right?.index;
}

function tablePositionFromElement(editor: Editor, table: HTMLTableElement) {
  const cell = table.rows[0]?.cells[0];
  if (!(cell instanceof HTMLElement)) return null;

  try {
    const domPos = editor.view.posAtDOM(cell, 0);
    const $pos = editor.state.doc.resolve(domPos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === "table") return $pos.before(depth);
    }
  } catch {
    return null;
  }
  return null;
}

function measureTable(editor: Editor, tablePos: number): TableGeometry | null {
  const shell = editor.view.dom.closest(".organize-editor-shell");
  const node = editor.state.doc.nodeAt(tablePos);
  const nodeDom = editor.view.nodeDOM(tablePos);
  if (!(shell instanceof HTMLElement) || !node || node.type.name !== "table") {
    return null;
  }

  const table = nodeDom instanceof HTMLTableElement
    ? nodeDom
    : nodeDom instanceof HTMLElement
      ? nodeDom.querySelector("table")
      : null;
  if (!(table instanceof HTMLTableElement)) return null;

  const shellRect = shell.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const wrapper = table.closest(".tableWrapper");
  const wrapperRect = wrapper instanceof HTMLElement
    ? wrapper.getBoundingClientRect()
    : tableRect;
  const visibleLeft = Math.max(
    0,
    Math.min(tableRect.width, wrapperRect.left - tableRect.left)
  );
  const visibleTop = Math.max(
    0,
    Math.min(tableRect.height, wrapperRect.top - tableRect.top)
  );
  const visibleRight = Math.max(
    visibleLeft,
    Math.min(tableRect.width, wrapperRect.right - tableRect.left)
  );
  const visibleBottom = Math.max(
    visibleTop,
    Math.min(tableRect.height, wrapperRect.bottom - tableRect.top)
  );
  const map = TableMap.get(node);
  const hasMergedCells = tableHasMergedCells(node);
  const rowElements = Array.from(table.tBodies[0]?.rows ?? table.rows);
  const rows = rowElements.slice(0, map.height).map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      start: rect.top - shellRect.top,
      size: rect.height,
    };
  });

  const colElements = Array.from(table.querySelectorAll("colgroup > col"));
  const columns: AxisRect[] = [];
  let nextLeft = tableRect.left - shellRect.left;
  for (let index = 0; index < map.width; index += 1) {
    const measuredWidth = colElements[index]?.getBoundingClientRect().width ?? 0;
    const width = measuredWidth > 0
      ? measuredWidth
      : tableRect.width / Math.max(1, map.width);
    columns.push({ start: nextLeft, size: width });
    nextLeft += width;
  }

  return {
    tablePos,
    left: tableRect.left - shellRect.left,
    top: tableRect.top - shellRect.top,
    width: tableRect.width,
    height: tableRect.height,
    visibleLeft,
    visibleTop,
    visibleRight,
    visibleBottom,
    rows,
    columns,
    hasMergedCells,
  };
}

function selectedAxis(editor: Editor): {
  geometry: TableGeometry;
  target: AxisTarget | null;
} | null {
  const table = getActiveTable(editor);
  if (!table) return null;
  const geometry = measureTable(editor, table.pos);
  if (!geometry) return null;
  const selection = editor.state.selection;
  if (!(selection instanceof CellSelection)) {
    return { geometry, target: null };
  }

  const map = TableMap.get(table.node);
  const tableStart = table.pos + 1;
  const rect = map.rectBetween(
    selection.$anchorCell.pos - tableStart,
    selection.$headCell.pos - tableStart
  );
  if (
    rect.left === 0
    && rect.top === 0
    && rect.right === map.width
    && rect.bottom === map.height
  ) {
    return { geometry, target: { axis: "table", index: 0 } };
  }
  if (selection.isRowSelection()) {
    return { geometry, target: { axis: "row", index: rect.top } };
  }
  if (selection.isColSelection()) {
    return { geometry, target: { axis: "column", index: rect.left } };
  }
  return { geometry, target: null };
}

function boundaryAt(rects: AxisRect[], coordinate: number) {
  let boundary = 0;
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (coordinate >= rect.start + rect.size / 2) boundary = index + 1;
  }
  return boundary;
}

function boundaryPosition(rects: AxisRect[], boundary: number) {
  if (!rects.length) return 0;
  if (boundary <= 0) return rects[0].start;
  if (boundary >= rects.length) {
    const last = rects[rects.length - 1];
    return last.start + last.size;
  }
  return rects[boundary].start;
}

function moveTargetIndex(from: number, boundary: number, count: number) {
  if (boundary === from || boundary === from + 1) return from;
  return Math.max(
    0,
    Math.min(count - 1, from < boundary ? boundary - 1 : boundary)
  );
}

function stopEditorMouseDown(event: React.MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function capturePointer(element: HTMLButtonElement, pointerId: number) {
  if (typeof element.setPointerCapture === "function") {
    element.setPointerCapture(pointerId);
  }
}

function releasePointer(element: HTMLButtonElement, pointerId: number) {
  if (
    typeof element.hasPointerCapture === "function"
    && typeof element.releasePointerCapture === "function"
    && element.hasPointerCapture(pointerId)
  ) {
    element.releasePointerCapture(pointerId);
  }
}

function updateRowResizePreview(resize: RowResize) {
  resize.previewStyle.textContent = [
    `.${resize.previewClass} > tbody > tr:nth-child(${resize.row + 1})`,
    `{ height: ${resize.height}px !important; }`,
  ].join(" ");
}

function removeRowResizePreview(resize: RowResize) {
  resize.tableElement.classList.remove(resize.previewClass);
  resize.previewStyle.remove();
}

export function TableDirectControls({ editor }: { editor: Editor }) {
  const [geometry, setGeometry] = useState<TableGeometry | null>(null);
  const geometryRef = useRef<TableGeometry | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<AxisTarget | null>(null);
  const [hoverTarget, setHoverTarget] = useState<AxisTarget | null>(null);
  const [dangerTarget, setDangerTarget] = useState<AxisTarget | null>(null);
  const [insertTarget, setInsertTarget] = useState<AxisTarget | null>(null);
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null);
  const dragVisualRef = useRef<DragVisual | null>(null);
  const [resizingRow, setResizingRow] = useState<number | null>(null);
  const dragRef = useRef<AxisDrag | null>(null);
  const resizeRef = useRef<RowResize | null>(null);

  const updateGeometry = useCallback((next: TableGeometry | null) => {
    geometryRef.current = next;
    setGeometry((previous) => {
      if (
        previous
        && next
        && previous.tablePos === next.tablePos
        && previous.left === next.left
        && previous.top === next.top
        && previous.width === next.width
        && previous.height === next.height
        && previous.visibleLeft === next.visibleLeft
        && previous.visibleTop === next.visibleTop
        && previous.visibleRight === next.visibleRight
        && previous.visibleBottom === next.visibleBottom
        && previous.hasMergedCells === next.hasMergedCells
        && previous.rows.length === next.rows.length
        && previous.columns.length === next.columns.length
        && previous.rows.every((row, index) => (
          row.start === next.rows[index]?.start && row.size === next.rows[index]?.size
        ))
        && previous.columns.every((column, index) => (
          column.start === next.columns[index]?.start
          && column.size === next.columns[index]?.size
        ))
      ) {
        return previous;
      }
      return next;
    });
  }, []);

  const syncSelection = useCallback(() => {
    const active = selectedAxis(editor);
    if (!active) {
      if (!dragRef.current && !resizeRef.current) updateGeometry(null);
      setSelectionTarget(null);
      return;
    }
    updateGeometry(active.geometry);
    setSelectionTarget((previous) => (
      targetEquals(previous, active.target) ? previous : active.target
    ));
  }, [editor, updateGeometry]);

  useLayoutEffect(() => {
    syncSelection();
  }, [syncSelection]);

  useEffect(() => {
    const sync = () => syncSelection();
    editor.on("selectionUpdate", sync);
    editor.on("transaction", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("transaction", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [editor, syncSelection]);

  useLayoutEffect(() => {
    const tablePos = geometryRef.current?.tablePos;
    if (tablePos === undefined || typeof ResizeObserver === "undefined") return;
    const nodeDom = editor.view.nodeDOM(tablePos);
    const table = nodeDom instanceof HTMLTableElement
      ? nodeDom
      : nodeDom instanceof HTMLElement
        ? nodeDom.querySelector("table")
        : null;
    const shell = editor.view.dom.closest(".organize-editor-shell");
    if (!(table instanceof HTMLTableElement) || !(shell instanceof HTMLElement)) {
      return;
    }

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        updateGeometry(measureTable(editor, tablePos));
      });
    });
    observer.observe(table);
    observer.observe(table.parentElement ?? table);
    observer.observe(shell);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [editor, geometry?.tablePos, updateGeometry]);

  useEffect(() => {
    const trackTable = (event: PointerEvent) => {
      if (dragRef.current || resizeRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-table-direct-controls]")) return;

      const table = target.closest("table");
      if (table && editor.view.dom.contains(table)) {
        const tablePos = tablePositionFromElement(editor, table);
        if (tablePos != null) updateGeometry(measureTable(editor, tablePos));
        return;
      }

      setHoverTarget(null);
      setDangerTarget(null);
      setInsertTarget(null);
      if (!selectionTarget) updateGeometry(null);
    };
    document.addEventListener("pointermove", trackTable, true);
    return () => document.removeEventListener("pointermove", trackTable, true);
  }, [editor, selectionTarget, updateGeometry]);

  const chooseTarget = useCallback((target: AxisTarget) => {
    const current = geometryRef.current;
    if (!current) return;
    if (target.axis === "table") selectWholeTable(editor, current.tablePos);
    if (target.axis === "row") selectTableRow(editor, current.tablePos, target.index);
    if (target.axis === "column") {
      selectTableColumn(editor, current.tablePos, target.index);
    }
  }, [editor]);

  const beginAxisDrag = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    target: AxisTarget
  ) => {
    if (event.button !== 0 || target.axis === "table") return;
    const current = geometryRef.current;
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    if (current.hasMergedCells) {
      chooseTarget(target);
      return;
    }
    capturePointer(event.currentTarget, event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      tablePos: current.tablePos,
      axis: target.axis,
      from: target.index,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      captureElement: event.currentTarget,
    };
  }, [chooseTarget]);

  const clearTransientTargets = useCallback(() => {
    setHoverTarget(null);
    setDangerTarget(null);
    setInsertTarget(null);
  }, []);

  const cancelInteraction = useCallback(() => {
    const resize = resizeRef.current;
    if (resize) {
      removeRowResizePreview(resize);
      releasePointer(resize.captureElement, resize.pointerId);
      updateGeometry(measureTable(editor, resize.tablePos));
    }
    const drag = dragRef.current;
    if (drag) releasePointer(drag.captureElement, drag.pointerId);
    dragRef.current = null;
    resizeRef.current = null;
    dragVisualRef.current = null;
    setDragVisual(null);
    setResizingRow(null);
    clearTransientTargets();
  }, [clearTransientTargets, editor, updateGeometry]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        const current = geometryRef.current;
        if (!current || current.tablePos !== drag.tablePos) return;
        if (!drag.active) {
          const distance = Math.hypot(
            event.clientX - drag.startX,
            event.clientY - drag.startY
          );
          if (distance < DRAG_THRESHOLD) return;
          drag.active = true;
        }
        event.preventDefault();
        const shell = editor.view.dom.closest(".organize-editor-shell");
        if (!(shell instanceof HTMLElement)) return;
        const shellRect = shell.getBoundingClientRect();
        const coordinate = drag.axis === "row"
          ? event.clientY - shellRect.top
          : event.clientX - shellRect.left;
        const rects = drag.axis === "row" ? current.rows : current.columns;
        const nextVisual: DragVisual = {
          axis: drag.axis,
          from: drag.from,
          boundary: boundaryAt(rects, coordinate),
          clientX: event.clientX - shellRect.left,
          clientY: event.clientY - shellRect.top,
        };
        dragVisualRef.current = nextVisual;
        setDragVisual(nextVisual);
        return;
      }

      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      event.preventDefault();
      resize.height = Math.max(
        MIN_ROW_HEIGHT,
        Math.round(resize.startHeight + event.clientY - resize.startY)
      );
      updateRowResizePreview(resize);
      updateGeometry(measureTable(editor, resize.tablePos));
    };

    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        const current = geometryRef.current;
        const visual = dragVisualRef.current;
        releasePointer(drag.captureElement, drag.pointerId);
        dragRef.current = null;
        dragVisualRef.current = null;
        setDragVisual(null);
        clearTransientTargets();
        if (!current || current.tablePos !== drag.tablePos) return;
        if (!drag.active || !visual || visual.axis !== drag.axis) {
          chooseTarget({ axis: drag.axis, index: drag.from });
          return;
        }
        const count = drag.axis === "row"
          ? current.rows.length
          : current.columns.length;
        const to = moveTargetIndex(drag.from, visual.boundary, count);
        if (to === drag.from) {
          chooseTarget({ axis: drag.axis, index: drag.from });
        } else if (drag.axis === "row") {
          moveActiveTableRow(editor, drag.tablePos, drag.from, to);
        } else {
          moveActiveTableColumn(editor, drag.tablePos, drag.from, to);
        }
        return;
      }

      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      releasePointer(resize.captureElement, resize.pointerId);
      removeRowResizePreview(resize);
      resizeRef.current = null;
      setResizingRow(null);
      clearTransientTargets();
      setTableRowHeight(
        editor,
        resize.tablePos,
        resize.row,
        resize.height
      );
    };

    const cancel = (event: PointerEvent) => {
      if (
        dragRef.current?.pointerId === event.pointerId
        || resizeRef.current?.pointerId === event.pointerId
      ) {
        cancelInteraction();
      }
    };

    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (dragRef.current || resizeRef.current)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelInteraction();
      }
    };
    const blur = () => {
      if (dragRef.current || resizeRef.current) cancelInteraction();
    };

    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
      const resize = resizeRef.current;
      if (resize) {
        removeRowResizePreview(resize);
        releasePointer(resize.captureElement, resize.pointerId);
      }
      const drag = dragRef.current;
      if (drag) releasePointer(drag.captureElement, drag.pointerId);
      dragRef.current = null;
      resizeRef.current = null;
      dragVisualRef.current = null;
    };
  }, [
    cancelInteraction,
    clearTransientTargets,
    chooseTarget,
    editor,
    updateGeometry,
  ]);

  const beginRowResize = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    row: number
  ) => {
    if (event.button !== 0) return;
    const current = geometryRef.current;
    if (!current) return;
    const nodeDom = editor.view.nodeDOM(current.tablePos);
    const table = nodeDom instanceof HTMLTableElement
      ? nodeDom
      : nodeDom instanceof HTMLElement
        ? nodeDom.querySelector("table")
        : null;
    if (!(table instanceof HTMLTableElement)) return;
    const rowElement = table.tBodies[0]?.rows[row];
    if (!(rowElement instanceof HTMLTableRowElement)) return;
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event.currentTarget, event.pointerId);
    rowResizePreviewId += 1;
    const previewClass = `organize-row-resize-preview-${rowResizePreviewId}`;
    const previewStyle = document.createElement("style");
    previewStyle.dataset.organizeRowResizePreview = "true";
    document.head.appendChild(previewStyle);
    table.classList.add(previewClass);
    const resize = {
      pointerId: event.pointerId,
      tablePos: current.tablePos,
      row,
      startY: event.clientY,
      startHeight: rowElement.getBoundingClientRect().height,
      height: rowElement.getBoundingClientRect().height,
      tableElement: table,
      previewClass,
      previewStyle,
      captureElement: event.currentTarget,
    };
    resizeRef.current = resize;
    updateRowResizePreview(resize);
    setResizingRow(row);
  }, [editor]);

  if (!geometry) return null;

  const currentTarget = dangerTarget ?? hoverTarget ?? selectionTarget;
  const highlightTarget = dangerTarget
    ?? (dragVisual ? { axis: dragVisual.axis, index: dragVisual.from } : hoverTarget);
  const rowLocal = (row: AxisRect) => row.start - geometry.top;
  const columnLocal = (column: AxisRect) => column.start - geometry.left;
  const rowIsVisible = (row: AxisRect) => (
    rowLocal(row) < geometry.visibleBottom
    && rowLocal(row) + row.size > geometry.visibleTop
  );
  const columnIsVisible = (column: AxisRect) => (
    columnLocal(column) < geometry.visibleRight
    && columnLocal(column) + column.size > geometry.visibleLeft
  );
  const rowBoundaryIsVisible = (boundary: number) => {
    const position = boundaryPosition(geometry.rows, boundary) - geometry.top;
    return position >= geometry.visibleTop && position <= geometry.visibleBottom;
  };
  const columnBoundaryIsVisible = (boundary: number) => {
    const position = boundaryPosition(geometry.columns, boundary) - geometry.left;
    return position >= geometry.visibleLeft && position <= geometry.visibleRight;
  };
  const clipTop = geometry.visibleTop - CONTROL_CLIP_GUTTER;
  const clipRight = geometry.width
    - geometry.visibleRight
    - CONTROL_CLIP_GUTTER;
  const clipBottom = geometry.height
    - geometry.visibleBottom
    - CONTROL_CLIP_GUTTER;
  const clipLeft = geometry.visibleLeft - CONTROL_CLIP_GUTTER;

  return (
    <div
      className="table-direct-controls"
      data-table-direct-controls
      data-dragging={dragVisual ? "true" : "false"}
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
        clipPath: `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`,
      }}
    >
      {highlightTarget?.axis === "table" && (
        <span
          className={cn(
            "table-axis-highlight table-axis-highlight-table",
            dangerTarget && "is-danger"
          )}
        />
      )}
      {highlightTarget?.axis === "row" && geometry.rows[highlightTarget.index] && (
        <span
          className={cn("table-axis-highlight", dangerTarget && "is-danger")}
          style={{
            left: 0,
            top: rowLocal(geometry.rows[highlightTarget.index]),
            width: geometry.width,
            height: geometry.rows[highlightTarget.index].size,
          }}
        />
      )}
      {highlightTarget?.axis === "column"
        && geometry.columns[highlightTarget.index] && (
          <span
            className={cn("table-axis-highlight", dangerTarget && "is-danger")}
            style={{
              left: columnLocal(geometry.columns[highlightTarget.index]),
              top: 0,
              width: geometry.columns[highlightTarget.index].size,
              height: geometry.height,
            }}
          />
        )}

      <button
        type="button"
        className={cn(
          "table-corner-handle",
          selectionTarget?.axis === "table" && "is-selected"
        )}
        aria-label="选择整张表格"
        title="选择整张表格"
        style={{
          top: geometry.visibleTop - CORNER_HANDLE_SIZE,
          left: geometry.visibleLeft - CORNER_HANDLE_SIZE,
        }}
        onMouseDown={stopEditorMouseDown}
        onMouseEnter={() => setHoverTarget({ axis: "table", index: 0 })}
        onMouseLeave={() => setHoverTarget(null)}
        onClick={() => chooseTarget({ axis: "table", index: 0 })}
      >
        <Table2 aria-hidden="true" />
      </button>

      {geometry.rows.map((row, index) => {
        if (!rowIsVisible(row)) return null;
        const target: AxisTarget = { axis: "row", index };
        const current = targetEquals(currentTarget, target);
        const selected = targetEquals(selectionTarget, target);
        return (
          <div
            key={`row-${index}`}
            className={cn(
              "table-row-control",
              (current || selected) && "is-visible"
            )}
            style={{
              top: rowLocal(row),
              left: geometry.visibleLeft - AXIS_GRIP_SIZE,
              height: row.size,
            }}
            onPointerEnter={() => setHoverTarget(target)}
            onPointerLeave={() => {
              if (!dragRef.current && !dangerTarget) setHoverTarget(null);
            }}
          >
            <button
              type="button"
              className={cn("table-axis-grip", selected && "is-selected")}
              aria-label={`选择或拖动第 ${index + 1} 行`}
              aria-pressed={selected}
              title={geometry.hasMergedCells
                ? "点击选择；含合并单元格时请先拆分再拖动"
                : "可拖拽和点击"}
              onPointerDown={(event) => beginAxisDrag(event, target)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  chooseTarget(target);
                }
              }}
            >
              <GripVertical aria-hidden="true" />
            </button>
            {current && (
              <span className="table-row-actions">
                <button
                  type="button"
                  aria-label={`在第 ${index + 1} 行下方添加行`}
                  title="在下方添加行"
                  onMouseDown={stopEditorMouseDown}
                  onClick={() => insertTableRowAt(editor, geometry.tablePos, index + 1)}
                >
                  <Plus aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label={`删除第 ${index + 1} 行`}
                  title="删除当前行"
                  disabled={geometry.rows.length <= 1}
                  onMouseDown={stopEditorMouseDown}
                  onMouseEnter={() => setDangerTarget(target)}
                  onMouseLeave={() => setDangerTarget(null)}
                  onClick={() => {
                    deleteTableRowAt(editor, geometry.tablePos, index);
                    setDangerTarget(null);
                    setHoverTarget(null);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        );
      })}

      {geometry.columns.map((column, index) => {
        if (!columnIsVisible(column)) return null;
        const target: AxisTarget = { axis: "column", index };
        const current = targetEquals(currentTarget, target);
        const selected = targetEquals(selectionTarget, target);
        return (
          <div
            key={`column-${index}`}
            className={cn(
              "table-column-control",
              (current || selected) && "is-visible"
            )}
            style={{
              left: columnLocal(column),
              top: geometry.visibleTop - AXIS_GRIP_SIZE,
              width: column.size,
            }}
            onPointerEnter={() => setHoverTarget(target)}
            onPointerLeave={() => {
              if (!dragRef.current && !dangerTarget) setHoverTarget(null);
            }}
          >
            <button
              type="button"
              className={cn("table-axis-grip", selected && "is-selected")}
              aria-label={`选择或拖动第 ${index + 1} 列`}
              aria-pressed={selected}
              title={geometry.hasMergedCells
                ? "点击选择；含合并单元格时请先拆分再拖动"
                : "可拖拽和点击"}
              onPointerDown={(event) => beginAxisDrag(event, target)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  chooseTarget(target);
                }
              }}
            >
              <GripHorizontal aria-hidden="true" />
            </button>
            {current && (
              <span className="table-column-actions">
                <button
                  type="button"
                  className="danger"
                  aria-label={`删除第 ${index + 1} 列`}
                  title="删除当前列"
                  disabled={geometry.columns.length <= 1}
                  onMouseDown={stopEditorMouseDown}
                  onMouseEnter={() => setDangerTarget(target)}
                  onMouseLeave={() => setDangerTarget(null)}
                  onClick={() => {
                    deleteTableColumnAt(editor, geometry.tablePos, index);
                    setDangerTarget(null);
                    setHoverTarget(null);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`在第 ${index + 1} 列右侧添加列`}
                  title="在右侧添加列"
                  onMouseDown={stopEditorMouseDown}
                  onClick={() => insertTableColumnAt(editor, geometry.tablePos, index + 1)}
                >
                  <Plus aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        );
      })}

      {Array.from({ length: geometry.rows.length + 1 }, (_, boundary) => {
        if (!rowBoundaryIsVisible(boundary)) return null;
        const top = boundaryPosition(geometry.rows, boundary) - geometry.top;
        const target: AxisTarget = { axis: "row", index: boundary };
        return (
          <button
            key={`row-insert-${boundary}`}
            type="button"
            className="table-boundary-add table-boundary-add-row"
            style={{
              top,
              left: geometry.visibleLeft - BOUNDARY_ADD_OFFSET,
            }}
            aria-label={`在第 ${boundary + 1} 行位置插入行`}
            title="在这里插入行"
            onMouseDown={stopEditorMouseDown}
            onMouseEnter={() => setInsertTarget(target)}
            onMouseLeave={() => setInsertTarget(null)}
            onClick={() => {
              insertTableRowAt(editor, geometry.tablePos, boundary);
              setInsertTarget(null);
            }}
          >
            <Plus aria-hidden="true" />
          </button>
        );
      })}

      {Array.from({ length: geometry.columns.length + 1 }, (_, boundary) => {
        if (!columnBoundaryIsVisible(boundary)) return null;
        const left = boundaryPosition(geometry.columns, boundary) - geometry.left;
        const target: AxisTarget = { axis: "column", index: boundary };
        return (
          <button
            key={`column-insert-${boundary}`}
            type="button"
            className="table-boundary-add table-boundary-add-column"
            style={{
              top: geometry.visibleTop - BOUNDARY_ADD_OFFSET,
              left,
            }}
            aria-label={`在第 ${boundary + 1} 列位置插入列`}
            title="在这里插入列"
            onMouseDown={stopEditorMouseDown}
            onMouseEnter={() => setInsertTarget(target)}
            onMouseLeave={() => setInsertTarget(null)}
            onClick={() => {
              insertTableColumnAt(editor, geometry.tablePos, boundary);
              setInsertTarget(null);
            }}
          >
            <Plus aria-hidden="true" />
          </button>
        );
      })}

      {geometry.rows.map((row, index) => (
        rowBoundaryIsVisible(index + 1) && (
        <button
          key={`row-resize-${index}`}
          type="button"
          className={cn(
            "table-row-resize-handle",
            resizingRow === index && "is-resizing"
          )}
          style={{
            top: rowLocal(row) + row.size,
            left: geometry.visibleLeft,
            width: Math.max(0, geometry.visibleRight - geometry.visibleLeft),
          }}
          aria-label={`调整第 ${index + 1} 行高度`}
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={MIN_ROW_HEIGHT}
          aria-valuenow={Math.round(row.size)}
          title="拖动调整行高"
          onPointerDown={(event) => beginRowResize(event, index)}
          onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const delta = event.key === "ArrowUp" ? -4 : 4;
            setTableRowHeight(
              editor,
              geometry.tablePos,
              index,
              Math.max(MIN_ROW_HEIGHT, Math.round(row.size + delta))
            );
          }}
        />
        )
      ))}

      {insertTarget?.axis === "row" && (
        <span
          className="table-insert-guide table-insert-guide-row"
          style={{
            top: boundaryPosition(geometry.rows, insertTarget.index) - geometry.top,
          }}
        />
      )}
      {insertTarget?.axis === "column" && (
        <span
          className="table-insert-guide table-insert-guide-column"
          style={{
            left: boundaryPosition(geometry.columns, insertTarget.index) - geometry.left,
          }}
        />
      )}

      {dragVisual && (
        <>
          <span
            className={cn(
              "table-drop-guide",
              dragVisual.axis === "row"
                ? "table-drop-guide-row"
                : "table-drop-guide-column"
            )}
            style={dragVisual.axis === "row"
              ? {
                  top: boundaryPosition(geometry.rows, dragVisual.boundary)
                    - geometry.top,
                }
              : {
                  left: boundaryPosition(geometry.columns, dragVisual.boundary)
                    - geometry.left,
                }}
          />
          <span
            className="table-drag-status"
            style={{
              left: dragVisual.clientX + 12 - geometry.left,
              top: dragVisual.clientY + 12 - geometry.top,
            }}
          >
            正在移动1{dragVisual.axis === "row" ? "行" : "列"}
          </span>
        </>
      )}
    </div>
  );
}
