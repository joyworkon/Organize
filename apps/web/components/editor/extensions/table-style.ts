import type { Editor, JSONContent } from "@tiptap/core";
import Table, { TableView } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Selection, Transaction } from "@tiptap/pm/state";
import {
  addColumn,
  addRow,
  CellSelection,
  moveTableColumn,
  moveTableRow,
  removeColumn,
  removeRow,
  TableMap,
  type TableRect,
} from "@tiptap/pm/tables";

export const TABLE_GRID_SIZE = 10;
export const TOP_LEVEL_BLOCK_PLACEHOLDER = "输入内容，或按 ⌘/ 打开区块菜单…";

export const TABLE_COLOR_SCHEMES = [
  "default",
  "gray",
  "green",
  "blue",
  "red",
  "dark",
] as const;

export type TableColorScheme = (typeof TABLE_COLOR_SCHEMES)[number];
export type TableWidthMode = "fit" | "content";

export interface ActiveTable {
  node: ProseMirrorNode;
  pos: number;
  widthMode: TableWidthMode;
  borderless: boolean;
  colorScheme: TableColorScheme;
  hasHeaderRow: boolean;
  hasHeaderColumn: boolean;
  hasCustomColumnWidths: boolean;
}

interface TableHeaderState {
  hasHeaderRow: boolean;
  hasHeaderColumn: boolean;
}

function normalizeWidthMode(value: unknown): TableWidthMode {
  return value === "content" ? "content" : "fit";
}

function normalizeColorScheme(value: unknown): TableColorScheme {
  return TABLE_COLOR_SCHEMES.includes(value as TableColorScheme)
    ? (value as TableColorScheme)
    : "default";
}

function normalizeRowHeight(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

export const OrganizeTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowHeight: {
        default: null,
        parseHTML: (element) =>
          normalizeRowHeight(
            element.getAttribute("data-row-height")
              ?? (element as HTMLElement).style.height
          ),
        renderHTML: (attributes) => {
          const rowHeight = normalizeRowHeight(attributes.rowHeight);
          return rowHeight === null
            ? {}
            : {
                "data-row-height": String(rowHeight),
                style: `height: ${rowHeight}px`,
              };
        },
      },
    };
  },
});

export const OrganizeTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      widthMode: {
        default: "fit",
        parseHTML: (element) => normalizeWidthMode(element.getAttribute("data-table-width")),
        renderHTML: (attributes) => ({
          "data-table-width": normalizeWidthMode(attributes.widthMode),
        }),
      },
      borderless: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-table-borderless") === "true",
        renderHTML: (attributes) =>
          attributes.borderless ? { "data-table-borderless": "true" } : {},
      },
      colorScheme: {
        default: "default",
        parseHTML: (element) => normalizeColorScheme(element.getAttribute("data-table-color")),
        renderHTML: (attributes) => ({
          "data-table-color": normalizeColorScheme(attributes.colorScheme),
        }),
      },
    };
  },
});

function syncTableDomAttributes(table: HTMLTableElement, node: ProseMirrorNode) {
  table.setAttribute("data-table-width", normalizeWidthMode(node.attrs.widthMode));
  table.setAttribute("data-table-color", normalizeColorScheme(node.attrs.colorScheme));
  if (node.attrs.borderless) {
    table.setAttribute("data-table-borderless", "true");
  } else {
    table.removeAttribute("data-table-borderless");
  }
}

function clearStaleColumnDomStyles(
  colgroup: HTMLTableColElement,
  node: ProseMirrorNode
) {
  // TipTap adds the newly applicable property but does not remove the opposite
  // inline width/min-width, so a cleared colwidth can remain visually fixed.
  const firstRow = node.firstChild;
  if (!firstRow) return;
  const columns = Array.from(colgroup.children) as HTMLTableColElement[];
  let columnIndex = 0;

  for (let cellIndex = 0; cellIndex < firstRow.childCount; cellIndex += 1) {
    const cell = firstRow.child(cellIndex);
    const colspan = Number(cell.attrs.colspan) || 1;
    const colwidth = cell.attrs.colwidth as number[] | null | undefined;

    for (let offset = 0; offset < colspan; offset += 1) {
      const column = columns[columnIndex];
      if (!column) return;
      if (colwidth?.[offset]) {
        column.style.removeProperty("min-width");
      } else {
        column.style.removeProperty("width");
      }
      columnIndex += 1;
    }
  }
}

function forEachDirectTableCell(
  table: ProseMirrorNode,
  callback: (cell: ProseMirrorNode, relativePos: number) => void
) {
  table.forEach((row, rowOffset) => {
    if (row.type.spec.tableRole !== "row") return;
    row.forEach((cell, cellOffset) => {
      if (!["cell", "header_cell"].includes(String(cell.type.spec.tableRole))) {
        return;
      }
      callback(cell, rowOffset + 1 + cellOffset);
    });
  });
}

function getTableHeaderState(table: ProseMirrorNode): TableHeaderState {
  const firstRow = table.firstChild;
  const hasHeaderRow = Boolean(
    firstRow?.childCount
    && Array.from({ length: firstRow.childCount }, (_, index) => firstRow.child(index))
      .every((cell) => cell.type.spec.tableRole === "header_cell")
  );
  const hasHeaderColumn = Boolean(
    table.childCount
    && Array.from({ length: table.childCount }, (_, index) => table.child(index))
      .every((row) => row.firstChild?.type.spec.tableRole === "header_cell")
  );
  return { hasHeaderRow, hasHeaderColumn };
}

export function tableHasMergedCells(table: ProseMirrorNode) {
  let hasMergedCells = false;
  forEachDirectTableCell(table, (cell) => {
    if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) {
      hasMergedCells = true;
    }
  });
  return hasMergedCells;
}

export class OrganizeTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    syncTableDomAttributes(this.table, node);
    clearStaleColumnDomStyles(this.colgroup, node);
  }

  update(node: ProseMirrorNode) {
    const updated = super.update(node);
    if (updated) {
      syncTableDomAttributes(this.table, node);
      clearStaleColumnDomStyles(this.colgroup, node);
    }
    return updated;
  }
}

export function createTableContent(
  rows: number,
  cols: number,
  withHeaderRow = true
): JSONContent {
  const safeRows = Number.isFinite(rows)
    ? Math.max(1, Math.min(TABLE_GRID_SIZE, Math.trunc(rows)))
    : 1;
  const safeCols = Number.isFinite(cols)
    ? Math.max(1, Math.min(TABLE_GRID_SIZE, Math.trunc(cols)))
    : 1;
  return {
    type: "table",
    attrs: {
      widthMode: "fit",
      borderless: false,
      colorScheme: "default",
    },
    content: Array.from({ length: safeRows }, (_, row) => ({
      type: "tableRow",
      content: Array.from({ length: safeCols }, () => ({
        type: withHeaderRow && row === 0 ? "tableHeader" : "tableCell",
        content: [{ type: "paragraph" }],
      })),
    })),
  };
}

export function topLevelBlockPlaceholder({
  editor,
  node,
  pos,
}: {
  editor: Editor;
  node: ProseMirrorNode;
  pos: number;
}) {
  if (node.type.name !== "paragraph") return "";
  return editor.state.doc.resolve(pos).parent === editor.state.doc
    ? TOP_LEVEL_BLOCK_PLACEHOLDER
    : "";
}

export function getActiveTable(editor: Editor): ActiveTable | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "table") continue;
    const { hasHeaderRow, hasHeaderColumn } = getTableHeaderState(node);
    let hasCustomColumnWidths = false;
    forEachDirectTableCell(node, (cell) => {
      if (cell.attrs.colwidth !== null && cell.attrs.colwidth !== undefined) {
        hasCustomColumnWidths = true;
      }
    });
    return {
      node,
      pos: $from.before(depth),
      widthMode: normalizeWidthMode(node.attrs.widthMode),
      borderless: Boolean(node.attrs.borderless),
      colorScheme: normalizeColorScheme(node.attrs.colorScheme),
      hasHeaderRow,
      hasHeaderColumn,
      hasCustomColumnWidths,
    };
  }
  return null;
}

export function setActiveTableAttributes(
  editor: Editor,
  attributes: Partial<Pick<ActiveTable, "widthMode" | "borderless" | "colorScheme">>
) {
  const table = getActiveTable(editor);
  if (!table) return false;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(table.pos, undefined, {
      ...table.node.attrs,
      ...attributes,
    })
  );
  return true;
}

export function equalizeActiveTableColumns(editor: Editor) {
  const table = getActiveTable(editor);
  if (!table) return false;
  let transaction = editor.state.tr.setNodeMarkup(table.pos, undefined, {
    ...table.node.attrs,
    widthMode: "fit",
  });
  forEachDirectTableCell(table.node, (cell, relativePos) => {
    if (cell.attrs.colwidth == null) return;
    transaction = transaction.setNodeMarkup(
      table.pos + 1 + relativePos,
      undefined,
      { ...cell.attrs, colwidth: null }
    );
  });
  editor.view.dispatch(transaction);
  return true;
}

interface TableContext {
  node: ProseMirrorNode;
  pos: number;
  start: number;
  map: TableMap;
}

function getTableContext(editor: Editor, tablePos: number): TableContext | null {
  if (!Number.isInteger(tablePos) || tablePos < 0) return null;
  const node = editor.state.doc.nodeAt(tablePos);
  if (!node || node.type.spec.tableRole !== "table") return null;
  return {
    node,
    pos: tablePos,
    start: tablePos + 1,
    map: TableMap.get(node),
  };
}

function getTableRect(context: TableContext): TableRect {
  return {
    left: 0,
    top: 0,
    right: context.map.width,
    bottom: context.map.height,
    tableStart: context.start,
    map: context.map,
    table: context.node,
  };
}

function isIndexInAxis(index: number, size: number) {
  return Number.isInteger(index) && index >= 0 && index < size;
}

function isIndexAtBoundary(index: number, size: number) {
  return Number.isInteger(index) && index >= 0 && index <= size;
}

function cellPosition(
  context: TableContext,
  rowIndex: number,
  columnIndex: number
) {
  return context.start
    + context.map.positionAt(rowIndex, columnIndex, context.node);
}

function wholeTableSelection(context: TableContext, doc: ProseMirrorNode) {
  const $firstCell = doc.resolve(cellPosition(context, 0, 0));
  const $lastCell = doc.resolve(
    cellPosition(context, context.map.height - 1, context.map.width - 1)
  );
  return CellSelection.rowSelection($firstCell, $lastCell);
}

function rowSelection(
  context: TableContext,
  doc: ProseMirrorNode,
  rowIndex: number
) {
  if (!isIndexInAxis(rowIndex, context.map.height)) return null;
  const $firstCell = doc.resolve(cellPosition(context, rowIndex, 0));
  const $lastCell = doc.resolve(
    cellPosition(context, rowIndex, context.map.width - 1)
  );
  return CellSelection.rowSelection($firstCell, $lastCell);
}

function columnSelection(
  context: TableContext,
  doc: ProseMirrorNode,
  columnIndex: number
) {
  if (!isIndexInAxis(columnIndex, context.map.width)) return null;
  const $firstCell = doc.resolve(cellPosition(context, 0, columnIndex));
  const $lastCell = doc.resolve(
    cellPosition(context, context.map.height - 1, columnIndex)
  );
  return CellSelection.colSelection($firstCell, $lastCell);
}

function contextAfterTransaction(
  transaction: Transaction,
  tablePos: number
): TableContext | null {
  const node = transaction.doc.nodeAt(tablePos);
  if (!node || node.type.spec.tableRole !== "table") return null;
  return {
    node,
    pos: tablePos,
    start: tablePos + 1,
    map: TableMap.get(node),
  };
}

function preserveLeadingHeaderAxes(
  editor: Editor,
  transaction: Transaction,
  context: TableContext,
  headerState: TableHeaderState,
  axis: "row" | "column"
) {
  const { hasHeaderRow, hasHeaderColumn } = headerState;
  if (!hasHeaderRow && !hasHeaderColumn) return;

  const coordinates: Array<{ row: number; column: number }> = [];
  if (axis === "row") {
    const affectedRows = hasHeaderRow ? [0, 1] : [0];
    for (const row of affectedRows) {
      for (let column = 0; column < context.map.width; column += 1) {
        coordinates.push({ row, column });
      }
    }
  } else {
    const affectedColumns = hasHeaderColumn ? [0, 1] : [0];
    for (let row = 0; row < context.map.height; row += 1) {
      for (const column of affectedColumns) {
        coordinates.push({ row, column });
      }
    }
  }

  const headerByCellPos = new Map<number, boolean>();
  for (const { row, column } of coordinates) {
    const relativePos = context.map.map[row * context.map.width + column];
    const absolutePos = context.start + relativePos;
    const shouldBeHeader = (hasHeaderRow && row === 0)
      || (hasHeaderColumn && column === 0);
    headerByCellPos.set(
      absolutePos,
      Boolean(headerByCellPos.get(absolutePos)) || shouldBeHeader
    );
  }

  const cellType = editor.schema.nodes.tableCell;
  const headerType = editor.schema.nodes.tableHeader;
  if (!cellType || !headerType) return;
  headerByCellPos.forEach((shouldBeHeader, cellPos) => {
    const cell = transaction.doc.nodeAt(cellPos);
    const targetType = shouldBeHeader ? headerType : cellType;
    if (cell && cell.type !== targetType) {
      transaction.setNodeMarkup(cellPos, targetType, cell.attrs);
    }
  });
}

function dispatchSelection(editor: Editor, selection: Selection | null) {
  if (!selection) return false;
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  return true;
}

export function selectWholeTable(editor: Editor, tablePos: number) {
  const context = getTableContext(editor, tablePos);
  return context
    ? dispatchSelection(editor, wholeTableSelection(context, editor.state.doc))
    : false;
}

export function selectTableRow(
  editor: Editor,
  tablePos: number,
  rowIndex: number
) {
  const context = getTableContext(editor, tablePos);
  return context
    ? dispatchSelection(editor, rowSelection(context, editor.state.doc, rowIndex))
    : false;
}

export function selectTableColumn(
  editor: Editor,
  tablePos: number,
  columnIndex: number
) {
  const context = getTableContext(editor, tablePos);
  return context
    ? dispatchSelection(
        editor,
        columnSelection(context, editor.state.doc, columnIndex)
      )
    : false;
}

export function insertTableRowAt(
  editor: Editor,
  tablePos: number,
  boundaryIndex: number
) {
  const context = getTableContext(editor, tablePos);
  if (!context || !isIndexAtBoundary(boundaryIndex, context.map.height)) {
    return false;
  }
  const headerState = getTableHeaderState(context.node);
  const transaction = addRow(
    editor.state.tr,
    getTableRect(context),
    boundaryIndex
  );
  let nextContext = contextAfterTransaction(transaction, tablePos);
  if (!nextContext) return false;
  if (boundaryIndex === 0) {
    preserveLeadingHeaderAxes(
      editor,
      transaction,
      nextContext,
      headerState,
      "row"
    );
    nextContext = contextAfterTransaction(transaction, tablePos);
    if (!nextContext) return false;
  }
  const selection = rowSelection(
    nextContext,
    transaction.doc,
    boundaryIndex
  );
  if (!selection) return false;
  editor.view.dispatch(transaction.setSelection(selection).scrollIntoView());
  return true;
}

export function insertTableColumnAt(
  editor: Editor,
  tablePos: number,
  boundaryIndex: number
) {
  const context = getTableContext(editor, tablePos);
  if (!context || !isIndexAtBoundary(boundaryIndex, context.map.width)) {
    return false;
  }
  const headerState = getTableHeaderState(context.node);
  const transaction = addColumn(
    editor.state.tr,
    getTableRect(context),
    boundaryIndex
  );
  let nextContext = contextAfterTransaction(transaction, tablePos);
  if (!nextContext) return false;
  if (boundaryIndex === 0) {
    preserveLeadingHeaderAxes(
      editor,
      transaction,
      nextContext,
      headerState,
      "column"
    );
    nextContext = contextAfterTransaction(transaction, tablePos);
    if (!nextContext) return false;
  }
  const selection = columnSelection(
    nextContext,
    transaction.doc,
    boundaryIndex
  );
  if (!selection) return false;
  editor.view.dispatch(transaction.setSelection(selection).scrollIntoView());
  return true;
}

export function deleteTableRowAt(
  editor: Editor,
  tablePos: number,
  rowIndex: number
) {
  const context = getTableContext(editor, tablePos);
  if (
    !context
    || context.map.height <= 1
    || !isIndexInAxis(rowIndex, context.map.height)
  ) {
    return false;
  }
  const transaction = editor.state.tr;
  removeRow(transaction, getTableRect(context), rowIndex);
  const nextContext = contextAfterTransaction(transaction, tablePos);
  if (!nextContext) return false;
  const selection = rowSelection(
    nextContext,
    transaction.doc,
    Math.min(rowIndex, nextContext.map.height - 1)
  );
  if (!selection) return false;
  editor.view.dispatch(transaction.setSelection(selection).scrollIntoView());
  return true;
}

export function deleteTableColumnAt(
  editor: Editor,
  tablePos: number,
  columnIndex: number
) {
  const context = getTableContext(editor, tablePos);
  if (
    !context
    || context.map.width <= 1
    || !isIndexInAxis(columnIndex, context.map.width)
  ) {
    return false;
  }
  const transaction = editor.state.tr;
  removeColumn(transaction, getTableRect(context), columnIndex);
  const nextContext = contextAfterTransaction(transaction, tablePos);
  if (!nextContext) return false;
  const selection = columnSelection(
    nextContext,
    transaction.doc,
    Math.min(columnIndex, nextContext.map.width - 1)
  );
  if (!selection) return false;
  editor.view.dispatch(transaction.setSelection(selection).scrollIntoView());
  return true;
}

export function moveActiveTableRow(
  editor: Editor,
  tablePos: number,
  from: number,
  to: number
) {
  const context = getTableContext(editor, tablePos);
  if (
    !context
    || from === to
    || !isIndexInAxis(from, context.map.height)
    || !isIndexInAxis(to, context.map.height)
  ) {
    return false;
  }
  const movedRowAttributes = Array.from(
    { length: context.node.childCount },
    (_, index) => context.node.child(index).attrs
  );
  const [movedAttributes] = movedRowAttributes.splice(from, 1);
  movedRowAttributes.splice(to, 0, movedAttributes);

  return moveTableRow({
    from,
    to,
    pos: context.start,
    select: true,
  })(editor.state, (transaction) => {
    const movedTable = transaction.doc.nodeAt(tablePos);
    if (movedTable?.type.spec.tableRole === "table") {
      let rowPos = tablePos + 1;
      for (let index = 0; index < movedTable.childCount; index += 1) {
        const row = movedTable.child(index);
        transaction.setNodeMarkup(
          rowPos,
          undefined,
          movedRowAttributes[index] ?? row.attrs
        );
        rowPos += row.nodeSize;
      }
    }
    editor.view.dispatch(transaction);
  });
}

export function moveActiveTableColumn(
  editor: Editor,
  tablePos: number,
  from: number,
  to: number
) {
  const context = getTableContext(editor, tablePos);
  if (
    !context
    || from === to
    || !isIndexInAxis(from, context.map.width)
    || !isIndexInAxis(to, context.map.width)
  ) {
    return false;
  }
  return moveTableColumn({
    from,
    to,
    pos: context.start,
    select: true,
  })(editor.state, editor.view.dispatch);
}

export function setTableRowHeight(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  rowHeight: number | null
) {
  const context = getTableContext(editor, tablePos);
  if (!context || !isIndexInAxis(rowIndex, context.node.childCount)) {
    return false;
  }
  let rowPos = context.start;
  for (let index = 0; index < rowIndex; index += 1) {
    rowPos += context.node.child(index).nodeSize;
  }
  const row = context.node.child(rowIndex);
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(rowPos, undefined, {
      ...row.attrs,
      rowHeight: normalizeRowHeight(rowHeight),
    })
  );
  return true;
}

function stripNodeIds(content: JSONContent): JSONContent {
  const attrs = content.attrs ? { ...content.attrs } : undefined;
  if (attrs && "id" in attrs) attrs.id = null;
  return {
    ...content,
    ...(attrs ? { attrs } : {}),
    ...(content.content
      ? { content: content.content.map((child) => stripNodeIds(child)) }
      : {}),
  };
}

export function duplicateActiveTable(editor: Editor, tablePos?: number) {
  const activeTable = tablePos === undefined ? getActiveTable(editor) : null;
  const resolvedTablePos = tablePos ?? activeTable?.pos;
  if (resolvedTablePos === undefined) return false;
  const context = getTableContext(editor, resolvedTablePos);
  if (!context) return false;

  const duplicate = editor.schema.nodeFromJSON(
    stripNodeIds(context.node.toJSON())
  );
  const duplicatePos = context.pos + context.node.nodeSize;
  const transaction = editor.state.tr.insert(duplicatePos, duplicate);
  const duplicateContext = contextAfterTransaction(transaction, duplicatePos);
  if (!duplicateContext) return false;
  editor.view.dispatch(
    transaction
      .setSelection(wholeTableSelection(duplicateContext, transaction.doc))
      .scrollIntoView()
  );
  return true;
}
