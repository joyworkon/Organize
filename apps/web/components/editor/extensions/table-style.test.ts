// @vitest-environment jsdom

import { Editor, type AnyExtension, type JSONContent } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import UniqueID from "@tiptap/extension-unique-id";
import StarterKit from "@tiptap/starter-kit";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrganizeTable,
  OrganizeTableCell,
  OrganizeTableHeader,
  OrganizeTableRow,
  TOP_LEVEL_BLOCK_PLACEHOLDER,
  createTableContent,
  deleteTableColumnAt,
  deleteTableRowAt,
  duplicateActiveTable,
  equalizeActiveTableColumns,
  getActiveTable,
  insertTableColumnAt,
  insertTableRowAt,
  moveActiveTableColumn,
  moveActiveTableRow,
  selectTableColumn,
  selectTableRow,
  selectWholeTable,
  setActiveTableAttributes,
  setSelectedCellsBackground,
  setTableRowHeight,
  tableHasMergedCells,
  topLevelBlockPlaceholder,
} from "./table-style";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function tableExtensions(extra: AnyExtension[] = []) {
  return [
    StarterKit,
    OrganizeTable,
    OrganizeTableRow,
    TableCell,
    TableHeader,
    ...extra,
  ];
}

function makeEditor() {
  editor = new Editor({
    extensions: tableExtensions(),
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: {
            widthMode: "content",
            borderless: true,
            colorScheme: "blue",
          },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: [180] },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "标题" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: [240] },
                  content: [{ type: "paragraph" }],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 1, rowspan: 1, colwidth: [180] },
                  content: [{ type: "paragraph" }],
                },
                {
                  type: "tableCell",
                  attrs: { colspan: 1, rowspan: 1, colwidth: [240] },
                  content: [{ type: "paragraph" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  editor.commands.setTextSelection(4);
  return editor;
}

function matrixTable(rows = 3, columns = 3): JSONContent {
  return {
    type: "table",
    attrs: {
      widthMode: "fit",
      borderless: false,
      colorScheme: "default",
    },
    content: Array.from({ length: rows }, (_, rowIndex) => ({
      type: "tableRow",
      content: Array.from({ length: columns }, (_, columnIndex) => ({
        type: "tableCell",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `${rowIndex}:${columnIndex}`,
              },
            ],
          },
        ],
      })),
    })),
  };
}

function headerMatrixTable(
  hasHeaderRow: boolean,
  hasHeaderColumn: boolean,
  rows = 2,
  columns = 2
): JSONContent {
  return {
    type: "table",
    attrs: {
      widthMode: "fit",
      borderless: false,
      colorScheme: "default",
    },
    content: Array.from({ length: rows }, (_, rowIndex) => ({
      type: "tableRow",
      content: Array.from({ length: columns }, (_, columnIndex) => ({
        type: (hasHeaderRow && rowIndex === 0)
          || (hasHeaderColumn && columnIndex === 0)
          ? "tableHeader"
          : "tableCell",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `${rowIndex}:${columnIndex}`,
              },
            ],
          },
        ],
      })),
    })),
  };
}

function nestedWidthTable(): JSONContent {
  const innerTable: JSONContent = {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          {
            type: "tableCell",
            attrs: { colspan: 2, rowspan: 1, colwidth: [180, 220] },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "inner-merged" }],
              },
            ],
          },
        ],
      },
      {
        type: "tableRow",
        content: [
          {
            type: "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: [180] },
            content: [{ type: "paragraph" }],
          },
          {
            type: "tableCell",
            attrs: { colspan: 1, rowspan: 1, colwidth: [220] },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    ],
  };
  const outer = matrixTable(2, 2);
  outer.content?.forEach((row) => {
    row.content?.forEach((cell, columnIndex) => {
      cell.attrs = {
        colspan: 1,
        rowspan: 1,
        colwidth: [columnIndex === 0 ? 120 : 160],
      };
    });
  });
  const firstOuterCell = outer.content?.[0].content?.[0];
  if (firstOuterCell) {
    firstOuterCell.content = [
      {
        type: "paragraph",
        content: [{ type: "text", text: "outer-anchor" }],
      },
      innerTable,
    ];
  }
  return outer;
}

function makeMatrixEditor(rows = 3, columns = 3) {
  editor = new Editor({
    extensions: tableExtensions(),
    content: {
      type: "doc",
      content: [matrixTable(rows, columns)],
    },
  });
  editor.commands.setTextSelection(4);
  return editor;
}

function makeContentEditor(content: JSONContent) {
  editor = new Editor({
    extensions: tableExtensions(),
    content: {
      type: "doc",
      content: [content],
    },
  });
  editor.commands.setTextSelection(4);
  return editor;
}

function tableAt(current: Editor, tablePos = 0) {
  const table = current.state.doc.nodeAt(tablePos);
  if (!table) throw new Error(`Expected table at ${tablePos}`);
  return table;
}

function tableText(current: Editor, tablePos = 0) {
  const table = tableAt(current, tablePos);
  return Array.from({ length: table.childCount }, (_, rowIndex) => {
    const row = table.child(rowIndex);
    return Array.from(
      { length: row.childCount },
      (_, columnIndex) => row.child(columnIndex).textContent
    );
  });
}

function selectionRect(current: Editor, tablePos = 0) {
  const selection = current.state.selection;
  expect(selection).toBeInstanceOf(CellSelection);
  const cellSelection = selection as CellSelection;
  const table = tableAt(current, tablePos);
  const map = TableMap.get(table);
  const tableStart = tablePos + 1;
  return {
    ...map.rectBetween(
      cellSelection.$anchorCell.pos - tableStart,
      cellSelection.$headCell.pos - tableStart
    ),
    isRowSelection: cellSelection.isRowSelection(),
    isColumnSelection: cellSelection.isColSelection(),
  };
}

function collectIds(node: ProseMirrorNode) {
  const ids: string[] = [];
  const visit = (candidate: ProseMirrorNode) => {
    if (typeof candidate.attrs.id === "string" && candidate.attrs.id) {
      ids.push(candidate.attrs.id);
    }
    candidate.forEach(visit);
  };
  visit(node);
  return ids;
}

function directCellTypes(table: ProseMirrorNode) {
  return Array.from({ length: table.childCount }, (_, rowIndex) => {
    const row = table.child(rowIndex);
    return Array.from(
      { length: row.childCount },
      (_, columnIndex) => row.child(columnIndex).type.name
    );
  });
}

function directCellWidths(table: ProseMirrorNode) {
  return Array.from({ length: table.childCount }, (_, rowIndex) => {
    const row = table.child(rowIndex);
    return Array.from(
      { length: row.childCount },
      (_, columnIndex) => row.child(columnIndex).attrs.colwidth
    );
  });
}

function findNestedTable(table: ProseMirrorNode) {
  let nested: ProseMirrorNode | null = null;
  table.descendants((node) => {
    if (node.type.spec.tableRole === "table") {
      nested = node;
      return false;
    }
    return nested === null;
  });
  return nested;
}

describe("OrganizeTable", () => {
  it("creates a bounded table grid with an optional header row", () => {
    const table = createTableContent(99, 0);
    expect(table.content).toHaveLength(10);
    expect(table.content?.[0].content).toHaveLength(1);
    expect(table.content?.[0].content?.[0].type).toBe("tableHeader");
    expect(table.content?.[1].content?.[0].type).toBe("tableCell");
  });

  it("persists layout attributes in JSON and HTML", () => {
    const current = makeEditor();
    expect(current.getJSON().content?.[0].attrs).toMatchObject({
      widthMode: "content",
      borderless: true,
      colorScheme: "blue",
    });
    expect(current.getHTML()).toContain('data-table-width="content"');
    expect(current.getHTML()).toContain('data-table-borderless="true"');
    expect(current.getHTML()).toContain('data-table-color="blue"');
  });

  it("detects headers and custom widths, then updates persistent settings", () => {
    const current = makeEditor();
    expect(getActiveTable(current)).toMatchObject({
      hasHeaderRow: true,
      hasHeaderColumn: true,
      hasCustomColumnWidths: true,
      widthMode: "content",
      borderless: true,
      colorScheme: "blue",
    });

    expect(setActiveTableAttributes(current, {
      widthMode: "fit",
      borderless: false,
      colorScheme: "green",
    })).toBe(true);
    expect(getActiveTable(current)).toMatchObject({
      widthMode: "fit",
      borderless: false,
      colorScheme: "green",
    });
  });

  it("clears saved cell widths when columns are equalized", () => {
    const current = makeEditor();
    const renderedColumns = () =>
      Array.from(
        current.view.dom.querySelectorAll<HTMLTableColElement>("colgroup > col")
      );
    expect(renderedColumns().map((column) => column.style.width)).toEqual([
      "180px",
      "240px",
    ]);

    expect(equalizeActiveTableColumns(current)).toBe(true);
    const table = getActiveTable(current);
    const widths: unknown[] = [];
    table?.node.descendants((node) => {
      if (["tableCell", "tableHeader"].includes(node.type.name)) {
        widths.push(node.attrs.colwidth);
      }
    });
    expect(widths).toEqual([null, null, null, null]);
    expect(table?.widthMode).toBe("fit");
    expect(table?.hasCustomColumnWidths).toBe(false);
    expect(renderedColumns().map((column) => column.style.width)).toEqual([
      "",
      "",
    ]);

    const persistedContent = current.getJSON();
    current.destroy();
    editor = new Editor({
      extensions: tableExtensions(),
      content: persistedContent,
    });
    editor.commands.setTextSelection(4);
    expect(getActiveTable(editor)?.hasCustomColumnWidths).toBe(false);
    expect(
      Array.from(
        editor.view.dom.querySelectorAll<HTMLTableColElement>("colgroup > col")
      ).map((column) => column.style.width)
    ).toEqual(["", ""]);
  });

  it("keeps nested table widths and merged-cell state scoped to the nested table", () => {
    const current = makeContentEditor(nestedWidthTable());
    const outerBefore = tableAt(current);
    const innerBefore = findNestedTable(outerBefore);
    expect(innerBefore).not.toBeNull();
    expect(getActiveTable(current)?.hasCustomColumnWidths).toBe(true);
    expect(tableHasMergedCells(outerBefore)).toBe(false);
    expect(tableHasMergedCells(innerBefore!)).toBe(true);
    const nestedWidthsBefore = directCellWidths(innerBefore!);

    expect(equalizeActiveTableColumns(current)).toBe(true);
    const outerAfter = tableAt(current);
    const innerAfter = findNestedTable(outerAfter);
    expect(directCellWidths(outerAfter)).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(innerAfter).not.toBeNull();
    expect(directCellWidths(innerAfter!)).toEqual(nestedWidthsBefore);
    expect(getActiveTable(current)?.hasCustomColumnWidths).toBe(false);
    expect(tableHasMergedCells(outerAfter)).toBe(false);
  });

  it("persists row height through JSON, HTML, and HTML parsing", () => {
    const current = makeMatrixEditor(2, 2);
    expect(setTableRowHeight(current, 0, 1, 72)).toBe(true);
    expect(tableAt(current).child(1).attrs.rowHeight).toBe(72);

    const html = current.getHTML();
    expect(html).toContain('data-row-height="72"');
    expect(html).toContain('style="height: 72px;"');

    current.destroy();
    editor = new Editor({
      extensions: tableExtensions(),
      content: html,
    });
    expect(tableAt(editor).child(1).attrs.rowHeight).toBe(72);
  });

  it("only decorates top-level paragraphs with the editor placeholder", () => {
    editor = new Editor({
      extensions: tableExtensions([
        Placeholder.configure({ placeholder: topLevelBlockPlaceholder }),
      ]),
      content: {
        type: "doc",
        content: [
          { type: "paragraph" },
          createTableContent(2, 2),
        ],
      },
    });

    const rootParagraph = editor.view.dom.firstElementChild;
    const table = editor.view.dom.querySelector("table");
    expect(rootParagraph?.getAttribute("data-placeholder")).toBe(
      TOP_LEVEL_BLOCK_PLACEHOLDER
    );
    expect(table?.querySelector("[data-placeholder]")).toBeNull();
    expect(table?.textContent).not.toContain(TOP_LEVEL_BLOCK_PLACEHOLDER);
  });

  it("selects a whole table, a requested row, and a requested column", () => {
    const current = makeMatrixEditor();

    expect(selectWholeTable(current, 0)).toBe(true);
    expect(selectionRect(current)).toMatchObject({
      left: 0,
      top: 0,
      right: 3,
      bottom: 3,
      isRowSelection: true,
      isColumnSelection: true,
    });

    expect(selectTableRow(current, 0, 1)).toBe(true);
    expect(selectionRect(current)).toMatchObject({
      left: 0,
      top: 1,
      right: 3,
      bottom: 2,
      isRowSelection: true,
      isColumnSelection: false,
    });

    expect(selectTableColumn(current, 0, 2)).toBe(true);
    expect(selectionRect(current)).toMatchObject({
      left: 2,
      top: 0,
      right: 3,
      bottom: 3,
      isRowSelection: false,
      isColumnSelection: true,
    });
    expect(selectTableRow(current, 0, 3)).toBe(false);
    expect(selectTableColumn(current, 0, -1)).toBe(false);
  });

  it("inserts at outer row and column boundaries and selects each new axis", () => {
    const current = makeMatrixEditor(2, 2);

    expect(insertTableRowAt(current, 0, 0)).toBe(true);
    expect(tableText(current)).toEqual([
      ["", ""],
      ["0:0", "0:1"],
      ["1:0", "1:1"],
    ]);
    expect(selectionRect(current)).toMatchObject({
      top: 0,
      bottom: 1,
      isRowSelection: true,
    });

    expect(insertTableColumnAt(current, 0, 2)).toBe(true);
    expect(tableText(current)).toEqual([
      ["", "", ""],
      ["0:0", "0:1", ""],
      ["1:0", "1:1", ""],
    ]);
    expect(selectionRect(current)).toMatchObject({
      left: 2,
      right: 3,
      isColumnSelection: true,
    });
    expect(insertTableRowAt(current, 0, 4)).toBe(false);
    expect(insertTableColumnAt(current, 0, -1)).toBe(false);
  });

  describe.each([
    { hasHeaderRow: false, hasHeaderColumn: false, label: "no headers" },
    { hasHeaderRow: true, hasHeaderColumn: false, label: "a header row" },
    { hasHeaderRow: false, hasHeaderColumn: true, label: "a header column" },
    { hasHeaderRow: true, hasHeaderColumn: true, label: "both header axes" },
  ])("leading insertion with $label", ({ hasHeaderRow, hasHeaderColumn }) => {
    const expectedType = (row: number, column: number) => (
      (hasHeaderRow && row === 0) || (hasHeaderColumn && column === 0)
        ? "tableHeader"
        : "tableCell"
    );

    it("keeps header roles fixed after inserting at the top boundary", () => {
      const current = makeContentEditor(
        headerMatrixTable(hasHeaderRow, hasHeaderColumn)
      );
      expect(insertTableRowAt(current, 0, 0)).toBe(true);

      const table = tableAt(current);
      expect(directCellTypes(table)).toEqual(
        Array.from({ length: 3 }, (_, row) =>
          Array.from({ length: 2 }, (_, column) => expectedType(row, column))
        )
      );
      expect(tableText(current)).toEqual([
        ["", ""],
        ["0:0", "0:1"],
        ["1:0", "1:1"],
      ]);
      expect(getActiveTable(current)).toMatchObject({
        hasHeaderRow,
        hasHeaderColumn,
      });
    });

    it("keeps header roles fixed after inserting at the left boundary", () => {
      const current = makeContentEditor(
        headerMatrixTable(hasHeaderRow, hasHeaderColumn)
      );
      expect(insertTableColumnAt(current, 0, 0)).toBe(true);

      const table = tableAt(current);
      expect(directCellTypes(table)).toEqual(
        Array.from({ length: 2 }, (_, row) =>
          Array.from({ length: 3 }, (_, column) => expectedType(row, column))
        )
      );
      expect(tableText(current)).toEqual([
        ["", "0:0", "0:1"],
        ["", "1:0", "1:1"],
      ]);
      expect(getActiveTable(current)).toMatchObject({
        hasHeaderRow,
        hasHeaderColumn,
      });
    });

    it("keeps header roles fixed while row and column content moves", () => {
      const current = makeContentEditor(
        headerMatrixTable(hasHeaderRow, hasHeaderColumn, 3, 3)
      );
      expect(moveActiveTableRow(current, 0, 0, 2)).toBe(true);
      expect(moveActiveTableColumn(current, 0, 2, 0)).toBe(true);

      const table = tableAt(current);
      expect(directCellTypes(table)).toEqual(
        Array.from({ length: 3 }, (_, row) =>
          Array.from({ length: 3 }, (_, column) => expectedType(row, column))
        )
      );
      expect(getActiveTable(current)).toMatchObject({
        hasHeaderRow,
        hasHeaderColumn,
      });
    });
  });

  it("deletes requested axes without reordering surviving content", () => {
    const current = makeMatrixEditor();

    expect(deleteTableRowAt(current, 0, 1)).toBe(true);
    expect(tableText(current)).toEqual([
      ["0:0", "0:1", "0:2"],
      ["2:0", "2:1", "2:2"],
    ]);
    expect(selectionRect(current)).toMatchObject({
      top: 1,
      bottom: 2,
      isRowSelection: true,
    });

    expect(deleteTableColumnAt(current, 0, 0)).toBe(true);
    expect(tableText(current)).toEqual([
      ["0:1", "0:2"],
      ["2:1", "2:2"],
    ]);
    expect(selectionRect(current)).toMatchObject({
      left: 0,
      right: 1,
      isColumnSelection: true,
    });
  });

  it("moves rows and columns with their content and selects the moved axis", () => {
    const current = makeMatrixEditor();

    expect(moveActiveTableRow(current, 0, 0, 2)).toBe(true);
    expect(tableText(current)).toEqual([
      ["1:0", "1:1", "1:2"],
      ["2:0", "2:1", "2:2"],
      ["0:0", "0:1", "0:2"],
    ]);
    expect(selectionRect(current)).toMatchObject({
      top: 2,
      bottom: 3,
      isRowSelection: true,
    });

    expect(moveActiveTableColumn(current, 0, 2, 0)).toBe(true);
    expect(tableText(current)).toEqual([
      ["1:2", "1:0", "1:1"],
      ["2:2", "2:0", "2:1"],
      ["0:2", "0:0", "0:1"],
    ]);
    expect(selectionRect(current)).toMatchObject({
      left: 0,
      right: 1,
      isColumnSelection: true,
    });
    expect(moveActiveTableRow(current, 0, 1, 1)).toBe(false);
  });

  it("moves row attributes together with row content", () => {
    const current = makeMatrixEditor();
    expect(setTableRowHeight(current, 0, 0, 80)).toBe(true);
    expect(setTableRowHeight(current, 0, 1, 44)).toBe(true);
    expect(setTableRowHeight(current, 0, 2, 60)).toBe(true);

    expect(moveActiveTableRow(current, 0, 0, 2)).toBe(true);
    const table = tableAt(current);
    expect(
      Array.from(
        { length: table.childCount },
        (_, index) => table.child(index).attrs.rowHeight
      )
    ).toEqual([44, 60, 80]);
    expect(tableText(current)).toEqual([
      ["1:0", "1:1", "1:2"],
      ["2:0", "2:1", "2:2"],
      ["0:0", "0:1", "0:2"],
    ]);
  });

  it("duplicates content in order without reusing any block IDs", () => {
    editor = new Editor({
      extensions: tableExtensions([
        UniqueID.configure({ types: ["table", "paragraph"] }),
      ]),
      content: {
        type: "doc",
        content: [
          {
            ...matrixTable(2, 2),
            attrs: {
              widthMode: "fit",
              borderless: false,
              colorScheme: "default",
              id: "table-original",
            },
            content: matrixTable(2, 2).content?.map((row, rowIndex) => ({
              ...row,
              content: row.content?.map((cell, columnIndex) => ({
                ...cell,
                content: [
                  {
                    type: "paragraph",
                    attrs: { id: `cell-${rowIndex}-${columnIndex}` },
                    content: [
                      {
                        type: "text",
                        text: `${rowIndex}:${columnIndex}`,
                      },
                    ],
                  },
                ],
              })),
            })),
          },
        ],
      },
    });
    editor.commands.setTextSelection(4);
    const original = tableAt(editor);
    const duplicatePos = original.nodeSize;
    const originalIds = collectIds(original);

    expect(duplicateActiveTable(editor)).toBe(true);
    const duplicate = tableAt(editor, duplicatePos);
    const duplicateIds = collectIds(duplicate);
    expect(tableText(editor, duplicatePos)).toEqual(tableText(editor));
    expect(duplicateIds).toHaveLength(originalIds.length);
    expect(duplicateIds).not.toContain("");
    expect(duplicateIds.some((id) => originalIds.includes(id))).toBe(false);
    expect(getActiveTable(editor)?.pos).toBe(duplicatePos);
    expect(selectionRect(editor, duplicatePos)).toMatchObject({
      left: 0,
      top: 0,
      right: 2,
      bottom: 2,
      isRowSelection: true,
      isColumnSelection: true,
    });
  });
});


describe("表格颜色（边框色 / 单元格背景）", () => {
  function colorExtensions() {
    return [
      StarterKit,
      OrganizeTable,
      OrganizeTableRow,
      OrganizeTableCell,
      OrganizeTableHeader,
    ];
  }

  function colorEditor(content?: JSONContent) {
    editor = new Editor({
      extensions: colorExtensions(),
      content: content ?? { type: "doc", content: [matrixTable(2, 2)] },
    });
    editor.commands.setTextSelection(4);
    return editor;
  }

  function cellBackgrounds(e: Editor): (string | null)[] {
    const table = getActiveTable(e);
    if (!table) return [];
    const backgrounds: (string | null)[] = [];
    table.node.forEach((row) => {
      row.forEach((cell) => {
        backgrounds.push((cell.attrs.background as string | null) ?? null);
      });
    });
    return backgrounds;
  }

  it("设置并读取表格边框颜色，非法值回退为 default", () => {
    const e = colorEditor();
    expect(setActiveTableAttributes(e, { borderColor: "blue" })).toBe(true);
    expect(getActiveTable(e)?.borderColor).toBe("blue");
    expect(
      setActiveTableAttributes(e, { borderColor: "not-a-color" as never })
    ).toBe(true);
    expect(getActiveTable(e)?.borderColor).toBe("default");
  });

  it("无边框色时 getActiveTable 返回 default", () => {
    const e = colorEditor();
    expect(getActiveTable(e)?.borderColor).toBe("default");
  });

  it("光标所在单元格设置背景色", () => {
    const e = colorEditor();
    expect(setSelectedCellsBackground(e, "green")).toBe(true);
    expect(cellBackgrounds(e)).toEqual(["green", null, null, null]);
  });

  it("单元格选区批量设置背景色，default 清除", () => {
    const e = colorEditor();
    expect(selectWholeTable(e, 0)).toBe(true);
    expect(setSelectedCellsBackground(e, "red")).toBe(true);
    expect(cellBackgrounds(e)).toEqual(["red", "red", "red", "red"]);
    expect(setSelectedCellsBackground(e, "default")).toBe(true);
    expect(cellBackgrounds(e)).toEqual([null, null, null, null]);
  });

  it("背景色随 HTML 渲染/解析持久化", () => {
    const e = colorEditor();
    expect(setSelectedCellsBackground(e, "blue")).toBe(true);
    const html = e.getHTML();
    expect(html).toContain('data-cell-bg="blue"');
    e.destroy();
    editor = new Editor({ extensions: colorExtensions(), content: html });
    editor.commands.setTextSelection(4);
    expect(cellBackgrounds(editor)).toEqual(["blue", null, null, null]);
  });

  it("表格边框色随 HTML 渲染/解析持久化", () => {
    const e = colorEditor();
    setActiveTableAttributes(e, { borderColor: "pink" });
    const html = e.getHTML();
    expect(html).toContain('data-table-border-color="pink"');
    e.destroy();
    editor = new Editor({ extensions: colorExtensions(), content: html });
    editor.commands.setTextSelection(4);
    expect(getActiveTable(editor)?.borderColor).toBe("pink");
  });

  it("光标不在单元格内时设置背景返回 false", () => {
    editor = new Editor({
      extensions: colorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    editor.commands.setTextSelection(1);
    expect(setSelectedCellsBackground(editor, "red")).toBe(false);
  });
});
