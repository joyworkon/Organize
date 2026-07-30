// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrganizeTable,
  createTableContent,
  equalizeActiveTableColumns,
  getActiveTable,
  setActiveTableAttributes,
} from "./table-style";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor() {
  editor = new Editor({
    extensions: [
      StarterKit,
      OrganizeTable,
      TableRow,
      TableCell,
      TableHeader,
    ],
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

  it("detects header row and column, then updates persistent settings", () => {
    const current = makeEditor();
    expect(getActiveTable(current)).toMatchObject({
      hasHeaderRow: true,
      hasHeaderColumn: true,
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
  });
});
