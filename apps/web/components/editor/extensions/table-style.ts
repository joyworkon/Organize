import type { Editor, JSONContent } from "@tiptap/core";
import Table, { TableView } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const TABLE_GRID_SIZE = 10;

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
}

function normalizeWidthMode(value: unknown): TableWidthMode {
  return value === "content" ? "content" : "fit";
}

function normalizeColorScheme(value: unknown): TableColorScheme {
  return TABLE_COLOR_SCHEMES.includes(value as TableColorScheme)
    ? (value as TableColorScheme)
    : "default";
}

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

export class OrganizeTableView extends TableView {
  constructor(node: ProseMirrorNode, cellMinWidth: number) {
    super(node, cellMinWidth);
    syncTableDomAttributes(this.table, node);
  }

  update(node: ProseMirrorNode) {
    const updated = super.update(node);
    if (updated) syncTableDomAttributes(this.table, node);
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

export function getActiveTable(editor: Editor): ActiveTable | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "table") continue;
    const firstRow = node.firstChild;
    const hasHeaderRow = Boolean(
      firstRow?.childCount
      && Array.from({ length: firstRow.childCount }, (_, index) => firstRow.child(index))
        .every((cell) => cell.type.name === "tableHeader")
    );
    const hasHeaderColumn = Boolean(
      node.childCount
      && Array.from({ length: node.childCount }, (_, index) => node.child(index))
        .every((row) => row.firstChild?.type.name === "tableHeader")
    );
    return {
      node,
      pos: $from.before(depth),
      widthMode: normalizeWidthMode(node.attrs.widthMode),
      borderless: Boolean(node.attrs.borderless),
      colorScheme: normalizeColorScheme(node.attrs.colorScheme),
      hasHeaderRow,
      hasHeaderColumn,
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
  table.node.descendants((node, relativePos) => {
    if (!["tableCell", "tableHeader"].includes(node.type.name)) return;
    if (node.attrs.colwidth == null) return;
    transaction = transaction.setNodeMarkup(
      table.pos + 1 + relativePos,
      undefined,
      { ...node.attrs, colwidth: null }
    );
  });
  editor.view.dispatch(transaction);
  return true;
}
