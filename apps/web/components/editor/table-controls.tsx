"use client";

import type { Editor } from "@tiptap/core";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Check,
  Columns3,
  Copy,
  Maximize2,
  Merge,
  Minimize2,
  MoveHorizontal,
  Palette,
  Rows3,
  Split,
  SquareSlash,
  TableProperties,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  TABLE_COLOR_SCHEMES,
  TABLE_GRID_SIZE,
  duplicateActiveTable,
  equalizeActiveTableColumns,
  getActiveTable,
  setActiveTableAttributes,
  type TableColorScheme,
} from "./extensions/table-style";

const COLOR_SCHEME_LABELS: Record<TableColorScheme, string> = {
  default: "默认",
  gray: "灰色",
  green: "绿色",
  blue: "蓝色",
  red: "红色",
  dark: "深色",
};

export function TableGridPicker({
  onSelect,
}: {
  onSelect: (rows: number, cols: number) => void;
}) {
  const [selection, setSelection] = useState({ rows: 2, cols: 2 });
  const gridRef = useRef<HTMLDivElement>(null);

  const moveFocus = (row: number, col: number) => {
    const nextRow = Math.max(1, Math.min(TABLE_GRID_SIZE, row));
    const nextCol = Math.max(1, Math.min(TABLE_GRID_SIZE, col));
    setSelection({ rows: nextRow, cols: nextCol });
    gridRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-table-grid-cell="${nextRow}-${nextCol}"]`
      )
      ?.focus();
  };

  return (
    <div className="table-grid-picker">
      <div className="table-grid-picker-title">表格</div>
      <div
        ref={gridRef}
        className="table-grid-picker-grid"
        role="grid"
        aria-label="选择表格尺寸"
      >
        {Array.from({ length: TABLE_GRID_SIZE }, (_, rowIndex) =>
          Array.from({ length: TABLE_GRID_SIZE }, (_, colIndex) => {
            const row = rowIndex + 1;
            const col = colIndex + 1;
            const selected = row <= selection.rows && col <= selection.cols;
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                role="gridcell"
                tabIndex={row === 1 && col === 1 ? 0 : -1}
                data-table-grid-cell={`${row}-${col}`}
                aria-label={`${row} 行 ${col} 列`}
                aria-selected={selected}
                className={selected ? "is-selected" : ""}
                onMouseEnter={() => setSelection({ rows: row, cols: col })}
                onFocus={() => setSelection({ rows: row, cols: col })}
                onClick={() => onSelect(row, col)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(row, col);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(row - 1, col);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus(row + 1, col);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    moveFocus(row, col - 1);
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault();
                    moveFocus(row, col + 1);
                  }
                }}
              />
            );
          })
        )}
      </div>
      <div className="table-grid-picker-size" aria-live="polite">
        {selection.rows} × {selection.cols}
      </div>
    </div>
  );
}

function ToolbarDropdown({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Rows3;
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [opensAbove, setOpensAbove] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updateDirection = () => {
      const triggerRect = ref.current?.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      if (!triggerRect || !menuRect) return;
      const spaceBelow = window.innerHeight - triggerRect.bottom - 12;
      const spaceAbove = triggerRect.top - 12;
      setOpensAbove(spaceBelow < menuRect.height && spaceAbove > spaceBelow);
    };
    updateDirection();
    window.addEventListener("resize", updateDirection);
    return () => window.removeEventListener("resize", updateDirection);
  }, [open]);

  return (
    <div className="table-toolbar-dropdown" ref={ref}>
      <button
        type="button"
        className={open ? "is-active" : ""}
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className={cn("table-toolbar-menu", opensAbove && "opens-above")}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuAction({
  icon: Icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: typeof Rows3;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn("table-toolbar-menu-action", danger && "danger")}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function SettingsSwitch({
  icon: Icon,
  label,
  checked,
  onChange,
}: {
  icon: typeof Rows3;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className="table-settings-switch"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <i className={checked ? "is-on" : ""}>
        <b />
      </i>
    </button>
  );
}

export function TableToolbar({
  editor,
  fullscreen,
  onToggleFullscreen,
}: {
  editor: Editor;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const [, refresh] = useReducer((value) => value + 1, 0);

  useEffect(() => {
    const update = () => refresh();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const table = getActiveTable(editor);
  if (!table) return null;

  const run = (action: () => void) => {
    action();
    editor.commands.focus();
    refresh();
  };

  return (
    <div
      className="table-toolbar"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className={table.widthMode === "fit" ? "table-toolbar-text is-active" : "table-toolbar-text"}
        title="让表格适应正文宽度"
        onClick={() =>
          run(() => {
            setActiveTableAttributes(editor, {
              widthMode: table.widthMode === "fit" ? "content" : "fit",
            });
          })
        }
      >
        <MoveHorizontal aria-hidden="true" />
        <span>自适应宽度</span>
      </button>
      <span className="table-toolbar-separator" />
      {table.hasCustomColumnWidths && (
        <button
          type="button"
          className="table-toolbar-text"
          title="平均分布列宽"
          aria-label="平均分布列宽"
          onClick={() => run(() => equalizeActiveTableColumns(editor))}
        >
          <Columns3 aria-hidden="true" />
          <span>列等宽</span>
        </button>
      )}
      <button
        type="button"
        title={fullscreen ? "退出全屏表格" : "全屏编辑表格"}
        aria-label={fullscreen ? "退出全屏表格" : "全屏编辑表格"}
        className={fullscreen ? "is-active" : ""}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
      </button>
      <button
        type="button"
        title={table.borderless ? "显示表格边框" : "隐藏表格边框"}
        aria-label={table.borderless ? "显示表格边框" : "隐藏表格边框"}
        className={table.borderless ? "is-active" : ""}
        onClick={() =>
          run(() => setActiveTableAttributes(editor, { borderless: !table.borderless }))
        }
      >
        <SquareSlash aria-hidden="true" />
      </button>
      <span className="table-toolbar-separator" />

      <ToolbarDropdown icon={Rows3} label="行操作">
        {(close) => (
          <>
            <MenuAction icon={ArrowUpToLine} label="在上方添加行" onClick={() => { run(() => editor.commands.addRowBefore()); close(); }} />
            <MenuAction icon={ArrowDownToLine} label="在下方添加行" onClick={() => { run(() => editor.commands.addRowAfter()); close(); }} />
            <MenuAction icon={Trash2} label="删除当前行" danger onClick={() => { run(() => editor.commands.deleteRow()); close(); }} />
          </>
        )}
      </ToolbarDropdown>

      <ToolbarDropdown icon={Columns3} label="列操作">
        {(close) => (
          <>
            <MenuAction icon={ArrowLeftToLine} label="在左侧添加列" onClick={() => { run(() => editor.commands.addColumnBefore()); close(); }} />
            <MenuAction icon={ArrowRightToLine} label="在右侧添加列" onClick={() => { run(() => editor.commands.addColumnAfter()); close(); }} />
            <MenuAction icon={Trash2} label="删除当前列" danger onClick={() => { run(() => editor.commands.deleteColumn()); close(); }} />
          </>
        )}
      </ToolbarDropdown>

      <ToolbarDropdown icon={Merge} label="单元格操作">
        {(close) => (
          <>
            <MenuAction icon={Merge} label="合并选中单元格" disabled={!editor.can().mergeCells()} onClick={() => { run(() => editor.commands.mergeCells()); close(); }} />
            <MenuAction icon={Split} label="拆分当前单元格" disabled={!editor.can().splitCell()} onClick={() => { run(() => editor.commands.splitCell()); close(); }} />
          </>
        )}
      </ToolbarDropdown>

      <ToolbarDropdown icon={TableProperties} label="表格设置">
        {(close) => (
          <div className="table-settings-menu">
            <SettingsSwitch
              icon={Rows3}
              label="标题行"
              checked={table.hasHeaderRow}
              onChange={() => run(() => editor.commands.toggleHeaderRow())}
            />
            <SettingsSwitch
              icon={Columns3}
              label="标题列"
              checked={table.hasHeaderColumn}
              onChange={() => run(() => editor.commands.toggleHeaderColumn())}
            />
            <div className="table-settings-color">
              <div>
                <Palette aria-hidden="true" />
                <span>配色方案</span>
              </div>
              <div className="table-color-swatches">
                {TABLE_COLOR_SCHEMES.map((scheme) => (
                  <button
                    key={scheme}
                    type="button"
                    className={cn(
                      `table-color-swatch table-color-${scheme}`,
                      table.colorScheme === scheme && "is-active"
                    )}
                    title={COLOR_SCHEME_LABELS[scheme]}
                    aria-label={COLOR_SCHEME_LABELS[scheme]}
                    onClick={() =>
                      run(() => setActiveTableAttributes(editor, { colorScheme: scheme }))
                    }
                  >
                    <span>A</span>
                    {table.colorScheme === scheme && <Check aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="table-toolbar-menu-separator" />
            <MenuAction
              icon={Trash2}
              label="删除表格"
              danger
              onClick={() => {
                run(() => editor.commands.deleteTable());
                close();
              }}
            />
          </div>
        )}
      </ToolbarDropdown>

      <span className="table-toolbar-separator" />
      <button
        type="button"
        title="复制表格"
        aria-label="复制表格"
        onClick={() => run(() => duplicateActiveTable(editor))}
      >
        <Copy aria-hidden="true" />
      </button>
      <button
        type="button"
        className="table-toolbar-danger"
        title="删除表格"
        aria-label="删除表格"
        onClick={() => run(() => editor.commands.deleteTable())}
      >
        <Trash2 aria-hidden="true" />
      </button>
    </div>
  );
}
