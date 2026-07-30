// @vitest-environment jsdom

import { Editor, type JSONContent } from "@tiptap/core";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import StarterKit from "@tiptap/starter-kit";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizeTable,
  OrganizeTableRow,
  OrganizeTableView,
} from "./extensions/table-style";
import { TableDirectControls } from "./table-direct-controls";

function box(left = 0, top = 0, width = 0, height = 0): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function matrixTable(rows = 3, columns = 3): JSONContent {
  return {
    type: "table",
    content: Array.from({ length: rows }, (_, row) => ({
      type: "tableRow",
      content: Array.from({ length: columns }, (_, column) => ({
        type: "tableCell",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `${row}:${column}` }],
          },
        ],
      })),
    })),
  };
}

function mergedTable(): JSONContent {
  const cell = (
    text: string,
    attrs: { colspan?: number; rowspan?: number } = {}
  ): JSONContent => ({
    type: "tableCell",
    attrs: {
      colspan: attrs.colspan ?? 1,
      rowspan: attrs.rowspan ?? 1,
      colwidth: null,
    },
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  });

  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          cell("跨两行", { rowspan: 2 }),
          cell("跨两列", { colspan: 2 }),
        ],
      },
      {
        type: "tableRow",
        content: [cell("1:1"), cell("1:2")],
      },
      {
        type: "tableRow",
        content: [cell("2:0"), cell("2:1"), cell("2:2")],
      },
    ],
  };
}

function tableWithNestedMergedTable(): JSONContent {
  const outer = matrixTable();
  const firstCell = outer.content?.[0].content?.[0];
  if (firstCell) {
    firstCell.content = [
      {
        type: "paragraph",
        content: [{ type: "text", text: "outer-anchor" }],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 2, rowspan: 1, colwidth: null },
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
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph" }],
              },
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      },
    ];
  }
  return outer;
}

function pointerEvent(
  type: string,
  {
    pointerId,
    clientX,
    clientY,
    button = 0,
  }: {
    pointerId: number;
    clientX: number;
    clientY: number;
    button?: number;
  }
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "mouse" },
    isPrimary: { value: true },
  });
  return event;
}

describe("TableDirectControls", () => {
  let editor: Editor;
  let shell: HTMLDivElement;
  let controlsHost: HTMLDivElement;
  let measuredTableRect: DOMRect;
  let measuredViewportRect: DOMRect;
  let root: Root | null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    measuredTableRect = box(140, 90, 300, 120);
    measuredViewportRect = measuredTableRect;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains("organize-editor-shell")) {
          return box(100, 50, 600, 400);
        }
        if (this instanceof HTMLTableElement) {
          return measuredTableRect;
        }
        if (this.classList.contains("tableWrapper")) {
          return measuredViewportRect;
        }
        if (this instanceof HTMLTableRowElement) {
          const table = this.closest("table");
          const row = Array.from(table?.rows ?? []).indexOf(this);
          const rowCount = Math.max(1, table?.rows.length ?? 0);
          const rowHeight = measuredTableRect.height / rowCount;
          return box(
            measuredTableRect.left,
            measuredTableRect.top + row * rowHeight,
            measuredTableRect.width,
            rowHeight
          );
        }
        if (this.tagName === "COL") {
          const table = this.closest("table");
          const columns = Array.from(
            table?.querySelectorAll("colgroup > col") ?? []
          );
          const column = columns.indexOf(this);
          const columnWidth = measuredTableRect.width
            / Math.max(1, columns.length);
          return box(
            measuredTableRect.left + column * columnWidth,
            measuredTableRect.top,
            columnWidth,
            measuredTableRect.height
          );
        }
        return box();
      });

    shell = document.createElement("div");
    shell.className = "organize-editor-shell";
    const editorHost = document.createElement("div");
    controlsHost = document.createElement("div");
    shell.append(editorHost, controlsHost);
    document.body.appendChild(shell);

    editor = new Editor({
      element: editorHost,
      extensions: [
        StarterKit,
        OrganizeTable.configure({
          resizable: true,
          lastColumnResizable: true,
          View: OrganizeTableView,
        }),
        OrganizeTableRow,
        TableCell,
        TableHeader,
      ],
      content: {
        type: "doc",
        content: [matrixTable()],
      },
    });
    editor.commands.setTextSelection(4);

    root = createRoot(controlsHost);
    act(() => {
      root?.render(createElement(TableDirectControls, { editor }));
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    editor.destroy();
    shell.remove();
    vi.restoreAllMocks();
  });

  it("renders accessible table, row, column, insertion, and resize controls", () => {
    expect(
      controlsHost.querySelector('[aria-label="选择整张表格"]')
    ).toBeInstanceOf(HTMLButtonElement);

    for (let index = 1; index <= 3; index += 1) {
      expect(
        controlsHost.querySelector(
          `[aria-label="选择或拖动第 ${index} 行"]`
        )
      ).toBeInstanceOf(HTMLButtonElement);
      expect(
        controlsHost.querySelector(
          `[aria-label="选择或拖动第 ${index} 列"]`
        )
      ).toBeInstanceOf(HTMLButtonElement);
      expect(
        controlsHost.querySelector(
          `[aria-label="调整第 ${index} 行高度"]`
        )
      ).toBeInstanceOf(HTMLButtonElement);
    }

    expect(
      controlsHost.querySelectorAll(
        ".table-boundary-add-row[aria-label]"
      )
    ).toHaveLength(4);
    expect(
      controlsHost.querySelectorAll(
        ".table-boundary-add-column[aria-label]"
      )
    ).toHaveLength(4);
    expect(
      controlsHost.querySelector(
        '[aria-label="在第 1 行位置插入行"]'
      )
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      controlsHost.querySelector(
        '[aria-label="在第 4 列位置插入列"]'
      )
    ).toBeInstanceOf(HTMLButtonElement);
  });

  it("inserts rows and columns from the outer boundary buttons", () => {
    const addLastRow = controlsHost.querySelector(
      '[aria-label="在第 4 行位置插入行"]'
    );
    expect(addLastRow).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      addLastRow?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    let table = editor.state.doc.nodeAt(0);
    expect(table).toBeDefined();
    expect(TableMap.get(table!).height).toBe(4);

    const addLastColumn = controlsHost.querySelector(
      '[aria-label="在第 4 列位置插入列"]'
    );
    expect(addLastColumn).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      addLastColumn?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    table = editor.state.doc.nodeAt(0);
    expect(table).toBeDefined();
    expect(TableMap.get(table!).width).toBe(4);
  });

  it("waits for the pointer threshold before showing drag state and status", () => {
    const controls = controlsHost.querySelector(
      "[data-table-direct-controls]"
    );
    const firstRowGrip = controlsHost.querySelector(
      '[aria-label="选择或拖动第 1 行"]'
    );
    expect(controls).toBeInstanceOf(HTMLDivElement);
    expect(firstRowGrip).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      firstRowGrip?.dispatchEvent(pointerEvent("pointerdown", {
        pointerId: 7,
        clientX: 130,
        clientY: 110,
      }));
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 7,
        clientX: 132,
        clientY: 112,
      }));
    });
    expect(controls?.getAttribute("data-dragging")).toBe("false");
    expect(controlsHost.querySelector(".table-drag-status")).toBeNull();

    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 7,
        clientX: 130,
        clientY: 180,
      }));
    });
    expect(controls?.getAttribute("data-dragging")).toBe("true");
    expect(
      controlsHost.querySelector(".table-drag-status")?.textContent
    ).toBe("正在移动1行");
    expect(controlsHost.querySelector(".table-drop-guide-row")).not.toBeNull();
  });

  it("moves a row when pointermove and pointerup arrive before React commits", () => {
    const firstRowGrip = controlsHost.querySelector(
      '[aria-label="选择或拖动第 1 行"]'
    );
    expect(firstRowGrip).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      firstRowGrip?.dispatchEvent(pointerEvent("pointerdown", {
        pointerId: 8,
        clientX: 130,
        clientY: 110,
      }));
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 8,
        clientX: 130,
        clientY: 180,
      }));
      window.dispatchEvent(pointerEvent("pointerup", {
        pointerId: 8,
        clientX: 130,
        clientY: 180,
      }));
    });

    const table = editor.state.doc.nodeAt(0);
    expect(table).toBeDefined();
    expect(
      Array.from(
        { length: table!.childCount },
        (_, row) => table!.child(row).child(0).textContent
      )
    ).toEqual(["1:0", "0:0", "2:0"]);
  });

  it("keeps row-resize preview out of the document and fully cancels it", async () => {
    const resizeHandle = controlsHost.querySelector(
      '[aria-label="调整第 1 行高度"]'
    );
    const firstRow = editor.view.dom.querySelector("tr");
    expect(resizeHandle).toBeInstanceOf(HTMLButtonElement);
    expect(firstRow).toBeInstanceOf(HTMLTableRowElement);
    const before = editor.getJSON();
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);

    act(() => {
      resizeHandle?.dispatchEvent(pointerEvent("pointerdown", {
        pointerId: 11,
        clientX: 200,
        clientY: 130,
      }));
      window.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 11,
        clientX: 200,
        clientY: 160,
      }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const preview = document.head.querySelector<HTMLStyleElement>(
      'style[data-organize-row-resize-preview="true"]'
    );
    expect(preview?.textContent).toContain("height: 70px");
    expect(firstRow?.style.height).toBe("");
    expect(editor.state.doc.nodeAt(0)?.child(0).attrs.rowHeight).toBeNull();
    expect(editor.getJSON()).toEqual(before);
    expect(onUpdate).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(pointerEvent("pointercancel", {
        pointerId: 11,
        clientX: 200,
        clientY: 160,
      }));
    });
    expect(
      document.head.querySelector(
        'style[data-organize-row-resize-preview="true"]'
      )
    ).toBeNull();
    expect(firstRow?.style.height).toBe("");
    expect(editor.getJSON()).toEqual(before);
    expect(onUpdate).not.toHaveBeenCalled();
    editor.off("update", onUpdate);
  });

  it("persists a completed row resize exactly once", () => {
    const resizeHandle = controlsHost.querySelector(
      '[aria-label="调整第 1 行高度"]'
    );
    expect(resizeHandle).toBeInstanceOf(HTMLButtonElement);
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);

    act(() => {
      resizeHandle?.dispatchEvent(pointerEvent("pointerdown", {
        pointerId: 12,
        clientX: 200,
        clientY: 130,
      }));
      window.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 12,
        clientX: 200,
        clientY: 160,
      }));
      window.dispatchEvent(pointerEvent("pointerup", {
        pointerId: 12,
        clientX: 200,
        clientY: 160,
      }));
    });

    expect(editor.state.doc.nodeAt(0)?.child(0).attrs.rowHeight).toBe(70);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(
      document.head.querySelector(
        'style[data-organize-row-resize-preview="true"]'
      )
    ).toBeNull();
    editor.off("update", onUpdate);
  });

  it("restores controls at fullscreen geometry when the pointer returns from the toolbar", () => {
    const toolbarButton = document.createElement("button");
    toolbarButton.type = "button";
    toolbarButton.textContent = "全屏编辑表格";
    document.body.appendChild(toolbarButton);

    expect(
      controlsHost.querySelector('[aria-label="选择整张表格"]')
    ).toBeInstanceOf(HTMLButtonElement);

    act(() => {
      toolbarButton.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 21,
        clientX: 720,
        clientY: 32,
      }));
    });
    expect(
      controlsHost.querySelector("[data-table-direct-controls]")
    ).toBeNull();

    measuredTableRect = box(40, 96, 900, 480);
    measuredViewportRect = box(20, 70, 960, 540);
    shell.dataset.tableFullscreen = "true";
    const table = editor.view.dom.querySelector("table");
    table?.classList.add("organize-table-fullscreen");
    const firstCell = table?.querySelector("td");
    expect(firstCell).toBeInstanceOf(HTMLTableCellElement);

    act(() => {
      firstCell?.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 21,
        clientX: 160,
        clientY: 130,
      }));
    });

    const controls = controlsHost.querySelector<HTMLElement>(
      "[data-table-direct-controls]"
    );
    expect(controls).toBeInstanceOf(HTMLDivElement);
    expect(controls?.style.left).toBe("-60px");
    expect(controls?.style.top).toBe("46px");
    expect(controls?.style.width).toBe("900px");
    expect(controls?.style.height).toBe("480px");
    expect(
      controlsHost.querySelector('[aria-label="选择或拖动第 1 行"]')
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      controlsHost.querySelector('[aria-label="选择或拖动第 1 列"]')
    ).toBeInstanceOf(HTMLButtonElement);
    expect(
      controlsHost.querySelector('[aria-label="调整第 1 行高度"]')
    ).toBeInstanceOf(HTMLButtonElement);

    toolbarButton.remove();
  });

  it("clips controls to a scrolled table viewport and keeps axis handles reachable", () => {
    measuredTableRect = box(40, -100, 900, 600);
    measuredViewportRect = box(100, 50, 600, 400);
    const firstCell = editor.view.dom.querySelector("td");
    const wrapper = firstCell?.closest(".tableWrapper");
    expect(firstCell).toBeInstanceOf(HTMLTableCellElement);
    expect(wrapper).toBeInstanceOf(HTMLDivElement);
    expect(wrapper?.getBoundingClientRect()).toEqual(measuredViewportRect);

    act(() => {
      firstCell?.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 22,
        clientX: 140,
        clientY: 80,
      }));
    });

    const controls = controlsHost.querySelector<HTMLElement>(
      "[data-table-direct-controls]"
    );
    const firstVisibleRowGrip = controlsHost.querySelector<HTMLElement>(
      '[aria-label="选择或拖动第 1 行"]'
    )?.parentElement;
    const firstVisibleColumnGrip = controlsHost.querySelector<HTMLElement>(
      '[aria-label="选择或拖动第 1 列"]'
    )?.parentElement;
    const resizeHandles = controlsHost.querySelectorAll(
      ".table-row-resize-handle"
    );
    expect(controls?.style.clipPath).toBe(
      "inset(70px 160px -30px -20px)"
    );
    expect(firstVisibleRowGrip?.style.left).toBe("44px");
    expect(firstVisibleColumnGrip?.style.top).toBe("134px");
    expect(resizeHandles).toHaveLength(2);
    expect((resizeHandles[0] as HTMLElement).style.left).toBe("60px");
    expect((resizeHandles[0] as HTMLElement).style.width).toBe("600px");
  });

  it("selects merged-table axes but never starts or applies row or column dragging", () => {
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [mergedTable()],
      });
      editor.commands.setTextSelection(4);
    });

    const controls = controlsHost.querySelector(
      "[data-table-direct-controls]"
    );
    const thirdRowGrip = controlsHost.querySelector(
      '[aria-label="选择或拖动第 3 行"]'
    );
    const firstColumnGrip = controlsHost.querySelector(
      '[aria-label="选择或拖动第 1 列"]'
    );
    expect(controls).toBeInstanceOf(HTMLDivElement);
    expect(thirdRowGrip).toBeInstanceOf(HTMLButtonElement);
    expect(firstColumnGrip).toBeInstanceOf(HTMLButtonElement);
    const before = editor.getJSON();

    act(() => {
      thirdRowGrip?.dispatchEvent(pointerEvent("pointerdown", {
        pointerId: 31,
        clientX: 130,
        clientY: 190,
      }));
    });
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).isRowSelection()).toBe(true);
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 31,
        clientX: 130,
        clientY: 100,
      }));
      window.dispatchEvent(pointerEvent("pointerup", {
        pointerId: 31,
        clientX: 130,
        clientY: 100,
      }));
    });

    expect(controls?.getAttribute("data-dragging")).toBe("false");
    expect(controlsHost.querySelector(".table-drag-status")).toBeNull();
    expect(controlsHost.querySelector(".table-drop-guide")).toBeNull();
    expect(editor.getJSON()).toEqual(before);

    act(() => {
      firstColumnGrip?.dispatchEvent(pointerEvent("pointerdown", {
        pointerId: 32,
        clientX: 190,
        clientY: 80,
      }));
    });
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect((editor.state.selection as CellSelection).isColSelection()).toBe(true);
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 32,
        clientX: 400,
        clientY: 80,
      }));
      window.dispatchEvent(pointerEvent("pointerup", {
        pointerId: 32,
        clientX: 400,
        clientY: 80,
      }));
    });

    expect(controls?.getAttribute("data-dragging")).toBe("false");
    expect(controlsHost.querySelector(".table-drag-status")).toBeNull();
    expect(controlsHost.querySelector(".table-drop-guide")).toBeNull();
    expect(editor.getJSON()).toEqual(before);
  });

  it("does not disable outer-table dragging for a merged table nested in a cell", () => {
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [tableWithNestedMergedTable()],
      });
      editor.commands.setTextSelection(4);
    });

    const controls = controlsHost.querySelector(
      "[data-table-direct-controls]"
    );
    const firstRowGrip = controlsHost.querySelector(
      '[aria-label="选择或拖动第 1 行"]'
    );
    expect(controls).toBeInstanceOf(HTMLDivElement);
    expect(firstRowGrip).toBeInstanceOf(HTMLButtonElement);
    expect(firstRowGrip?.getAttribute("title")).toBe("可拖拽和点击");
    const before = editor.getJSON();

    act(() => {
      firstRowGrip?.dispatchEvent(pointerEvent("pointerdown", {
        pointerId: 41,
        clientX: 130,
        clientY: 110,
      }));
      window.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 41,
        clientX: 130,
        clientY: 180,
      }));
    });

    expect(controls?.getAttribute("data-dragging")).toBe("true");
    expect(controlsHost.querySelector(".table-drag-status")).not.toBeNull();

    act(() => {
      window.dispatchEvent(pointerEvent("pointercancel", {
        pointerId: 41,
        clientX: 130,
        clientY: 180,
      }));
    });
    expect(controls?.getAttribute("data-dragging")).toBe("false");
    expect(editor.getJSON()).toEqual(before);
  });

  it("routes hover controls to the nested table instead of its containing cell", () => {
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [tableWithNestedMergedTable()],
      });
      editor.commands.setTextSelection(4);
    });

    const tables = editor.view.dom.querySelectorAll("table");
    const nestedCell = tables[1]?.rows[0]?.cells[0];
    expect(tables).toHaveLength(2);
    expect(nestedCell).toBeInstanceOf(HTMLTableCellElement);

    act(() => {
      nestedCell?.dispatchEvent(pointerEvent("pointermove", {
        pointerId: 42,
        clientX: 220,
        clientY: 170,
      }));
    });

    expect(
      controlsHost.querySelectorAll('[aria-label^="选择或拖动第"][aria-label$="行"]')
    ).toHaveLength(2);
    expect(
      controlsHost.querySelectorAll('[aria-label^="选择或拖动第"][aria-label$="列"]')
    ).toHaveLength(2);
  });

  it("removes TipTap subscriptions and global pointer listeners on unmount", () => {
    const editorOff = vi.spyOn(editor, "off");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");

    act(() => root?.unmount());
    root = null;

    expect(editorOff).toHaveBeenCalledWith(
      "selectionUpdate",
      expect.any(Function)
    );
    expect(editorOff).toHaveBeenCalledWith(
      "transaction",
      expect.any(Function)
    );
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
      true
    );
    for (const event of ["pointermove", "pointerup", "pointercancel"]) {
      expect(removeWindowListener).toHaveBeenCalledWith(
        event,
        expect.any(Function),
        true
      );
    }
    expect(removeWindowListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
      true
    );
    expect(removeWindowListener).toHaveBeenCalledWith(
      "blur",
      expect.any(Function)
    );
  });
});
