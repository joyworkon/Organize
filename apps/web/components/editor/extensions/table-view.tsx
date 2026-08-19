"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Trash2, GripVertical, Type, Hash, CheckSquare, Calendar, Link, List,
  ListChecks, ChevronDown, FileText, Image as FileIcon, X, Check,
} from "lucide-react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabasePropertyType } from "@organize/shared";

interface TableViewProps {
  databaseId: string;
  readOnly?: boolean;
  /** 每列宽度（propId → px），持久化在 view.config.columnWidths */
  columnWidths?: Record<string, number>;
  /** 列宽变化回调（拖拽松手时触发，持久化由父层负责） */
  onUpdateColumnWidths?: (widths: Record<string, number>) => void;
}

const DEFAULT_COL_WIDTH = 160;     // 默认列宽 px
const MIN_COL_WIDTH = 60;          // 最小列宽 px

const TYPE_META: Record<DatabasePropertyType, { icon: typeof Type; label: string }> = {
  text: { icon: Type, label: "文本" },
  number: { icon: Hash, label: "数字" },
  select: { icon: List, label: "单选" },
  multi_select: { icon: ListChecks, label: "多选" },
  checkbox: { icon: CheckSquare, label: "复选框" },
  date: { icon: Calendar, label: "日期" },
  file: { icon: FileIcon, label: "文件" },
  url: { icon: Link, label: "链接" },
};

const PROPERTY_TYPE_ORDER: DatabasePropertyType[] = [
  "text", "number", "select", "multi_select", "checkbox", "date", "url", "file",
];

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function randomOptionColor(): string {
  const palette = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#14b8a6"];
  return palette[Math.floor(Math.random() * palette.length)];
}

function defaultSchema(): DatabaseProperty[] {
  return [{ id: "prop_name", name: "名称", type: "text" }];
}

function formatCellDisplay(value: unknown, prop: DatabaseProperty): React.ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="organize-db-empty">空</span>;
  }
  switch (prop.type) {
    case "checkbox":
      return <Check className="h-3.5 w-3.5" style={{ color: Boolean(value) ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / .4)" }} />;
    case "select": {
      const optId = String(value);
      const opt = (prop.options || []).find((o) => o.id === optId);
      if (opt) {
        return (
          <span
            className="organize-db-tag"
            style={opt.color ? { background: `${opt.color}22`, color: opt.color } : undefined}
          >{opt.name}</span>
        );
      }
      return <span className="organize-db-tag">{optId}</span>;
    }
    case "multi_select": {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="organize-db-tag-list">
          {ids.map((id) => {
            const opt = (prop.options || []).find((o) => o.id === id);
            if (!opt) return <span key={id} className="organize-db-tag">{id}</span>;
            return (
              <span
                key={id}
                className="organize-db-tag"
                style={opt.color ? { background: `${opt.color}22`, color: opt.color } : undefined}
              >{opt.name}</span>
            );
          })}
        </span>
      );
    }
    case "date":
      return String(value);
    case "url":
      return <a href={String(value)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="organize-db-link">{String(value)}</a>;
    case "number":
      return String(value);
    case "file":
      return <span className="organize-db-tag"><FileText className="h-3 w-3" />文件</span>;
    case "text":
    default:
      return String(value);
  }
}

export function TableView({ databaseId, readOnly = false, columnWidths, onUpdateColumnWidths }: TableViewProps) {
  const [db, setDb] = useState<DatabaseRecord | null>(null);
  const [rows, setRows] = useState<DatabaseRowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; propId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  // canvas 2d 上下文 ref，用于双击自适应列宽时离屏测量文本宽度（缓存复用）
  const measureCanvasRef = useRef<CanvasRenderingContext2D | null>(null);
  // 拖拽中的列宽（本地乐观，松手才落库）
  const [dragWidths, setDragWidths] = useState<Record<string, number> | null>(null);

  /** 取某列当前生效宽度（拖拽中用 dragWidths，否则用持久化的 columnWidths，否则默认） */
  const colWidth = (propId: string): number =>
    (dragWidths?.[propId] ?? columnWidths?.[propId] ?? DEFAULT_COL_WIDTH);

  /** 列宽拖拽：onMouseDown 记录起点，全局监听 mousemove/up（鼠标移出 th 也能拖） */
  const startResize = (e: React.MouseEvent, propId: string) => {
    if (readOnly || !onUpdateColumnWidths) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = colWidth(propId);
    const base = { ...(columnWidths || {}), ...(dragWidths || {}) };
    // 用 ref 持有最新宽度，松手时读取（避免在 setState updater 里做副作用）
    const latest = { ...base, [propId]: startW };

    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_COL_WIDTH, startW + (ev.clientX - startX));
      latest[propId] = next;
      setDragWidths({ ...latest });
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // 副作用放在事件处理器里（不在 updater 内）
      onUpdateColumnWidths(latest);
      setDragWidths(null); // 清掉本地乐观，交回 columnWidths（props）驱动
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  /** 双击列手柄：按「这一列所有单元格 + 表头」的实际内容宽度自适应。
   *  实现：临时取消该列所有 td/th 的固定宽（不靠 colgroup，靠测内容 scrollWidth），
   *  取各单元内容 scrollWidth 的最大值 + padding，作为新列宽。
   *  纯 DOM 测量，不触发重排外的副作用；测完落库持久化。
   */
  const autoFitColumn = (propId: string) => {
    if (readOnly || !onUpdateColumnWidths) return;

    // 收集这一列的表头名 + 所有单元格的文本内容，用 canvas 离屏量字宽（最快且不抖动）
    const prop = schema.find((p) => p.id === propId);
    if (!prop) return;
    const headerText = prop.name;
    const cells = rows.map((r) => {
      const v = (r.values || {})[propId];
      // 复用 formatCellDisplay 的字符串化逻辑（select→选项名、multi→逗号串、其余 String）
      if (v === null || v === undefined || v === "") return "";
      if (prop.type === "select") {
        const opt = (prop.options || []).find((o) => o.id === v);
        return opt?.name || String(v);
      }
      if (prop.type === "multi_select") {
        const ids = Array.isArray(v) ? (v as string[]) : [];
        return ids.map((id) => (prop.options || []).find((o) => o.id === id)?.name || id).join(", ");
      }
      return String(v);
    });

    // canvas 离屏测宽（表头用 12px，单元格用 13px，对齐 CSS）
    if (!measureCanvasRef.current) {
      measureCanvasRef.current = document.createElement("canvas").getContext("2d");
    }
    const ctx = measureCanvasRef.current;
    if (!ctx) return;
    const padX = 20; // .organize-db-cell 左右 padding 10+10
    const measure = (text: string, font: string) => {
      ctx.font = font;
      return Math.ceil(ctx.measureText(text || " ").width) + padX;
    };
    const headerW = measure(headerText, "500 12px system-ui, sans-serif");
    let maxCellW = 0;
    for (const text of cells) {
      maxCellW = Math.max(maxCellW, measure(text, "13px system-ui, sans-serif"));
    }
    const fitted = Math.max(MIN_COL_WIDTH, Math.max(headerW, maxCellW));
    const base = { ...(columnWidths || {}), ...(dragWidths || {}) };
    onUpdateColumnWidths({ ...base, [propId]: fitted });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dbRes, rowsRes] = await Promise.all([
        fetch(`/api/databases/${databaseId}`),
        fetch(`/api/databases/${databaseId}/rows`),
      ]);
      if (!dbRes.ok) throw new Error("加载数据库失败");
      if (!rowsRes.ok) throw new Error("加载行失败");
      const dbData = (await dbRes.json()) as DatabaseRecord;
      const rowsData = (await rowsRes.json()) as DatabaseRowRecord[];
      setDb(dbData);
      setRows(rowsData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [databaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 点击其他地方关闭列菜单
  useEffect(() => {
    if (!activeColumnMenu) return;
    const handler = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setActiveColumnMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeColumnMenu]);

  const schema = useMemo<DatabaseProperty[]>(() => {
    if (!db || !Array.isArray(db.schema) || db.schema.length === 0) return defaultSchema();
    return db.schema as DatabaseProperty[];
  }, [db]);

  const patchSchema = useCallback(async (newSchema: DatabaseProperty[]) => {
    if (!db) return;
    setSaving(true);
    const prevDb = db;
    setDb({ ...db, schema: newSchema });
    try {
      const res = await fetch(`/api/databases/${databaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: newSchema }),
      });
      if (!res.ok) throw new Error("更新列失败");
      const updated = (await res.json()) as DatabaseRecord;
      setDb(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setDb(prevDb);
    } finally {
      setSaving(false);
    }
  }, [db, databaseId]);

  const addRow = async () => {
    if (saving || readOnly) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/databases/${databaseId}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: {} }),
      });
      if (!res.ok) throw new Error("添加行失败");
      const newRow = (await res.json()) as DatabaseRowRecord;
      setRows((prev) => [...prev, newRow]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (rowId: string) => {
    if (saving || readOnly) return;
    if (!window.confirm("确定删除这一行？")) return;
    setSaving(true);
    const prevRows = rows;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    try {
      const res = await fetch(`/api/databases/${databaseId}/rows/${rowId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除行失败");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setRows(prevRows);
    } finally {
      setSaving(false);
    }
  };

  const updateCell = async (rowId: string, propId: string, value: unknown) => {
    if (saving || readOnly) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const newValues = { ...(row.values as Record<string, unknown>), [propId]: value };
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, values: newValues } : r)));
    setEditingCell(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: newValues }),
      });
      if (!res.ok) throw new Error("更新单元格失败");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      void load();
    } finally {
      setSaving(false);
    }
  };

  const addColumn = async (type: DatabasePropertyType = "text") => {
    if (saving || readOnly || !db) return;
    const name = await showPrompt({ title: "新建列", placeholder: "列名" });
    if (!name) return;
    const newProp: DatabaseProperty = {
      id: generateId("prop"),
      name: name.trim(),
      type,
      options: (type === "select" || type === "multi_select") ? [] : undefined,
    };
    await patchSchema([...schema, newProp]);
  };

  const renameColumn = async (prop: DatabaseProperty) => {
    if (readOnly) return;
    const name = await showPrompt({ title: "重命名列", defaultValue: prop.name });
    if (!name || name === prop.name) return;
    await patchSchema(schema.map((p) => (p.id === prop.id ? { ...p, name: name.trim() } : p)));
  };

  const changeColumnType = async (prop: DatabaseProperty, newType: DatabasePropertyType) => {
    if (readOnly || newType === prop.type) return;
    const needsOptions = newType === "select" || newType === "multi_select";
    const newSchema = schema.map((p) => {
      if (p.id !== prop.id) return p;
      return {
        ...p,
        type: newType,
        options: needsOptions ? (p.options || []) : undefined,
      };
    });
    // 如果切到 select/multi_select 且之前不是，扫一下现有值收集成 options
    if (needsOptions && !(prop.type === "select" || prop.type === "multi_select")) {
      const opts = new Map<string, { id: string; name: string; color?: string }>();
      for (const r of rows) {
        const v = (r.values as Record<string, unknown>)[prop.id];
        const collect = (val: unknown) => {
          if (val === null || val === undefined || val === "") return;
          const s = String(val);
          if (!opts.has(s)) opts.set(s, { id: generateId("opt"), name: s, color: randomOptionColor() });
        };
        if (Array.isArray(v)) v.forEach(collect); else collect(v);
      }
      const idx = newSchema.findIndex((p) => p.id === prop.id);
      if (idx >= 0) newSchema[idx] = { ...newSchema[idx], options: Array.from(opts.values()) };
    }
    await patchSchema(newSchema);
  };

  const deleteColumn = async (prop: DatabaseProperty) => {
    if (readOnly) return;
    if (schema.length <= 1) {
      toast({ title: "至少保留一列", variant: "destructive" });
      return;
    }
    if (!window.confirm(`确定删除列「${prop.name}」？该列所有数据将被清空。`)) return;
    const newSchema = schema.filter((p) => p.id !== prop.id);
    // 同步清空所有行里该字段
    const newRows = rows.map((r) => {
      const v = { ...(r.values as Record<string, unknown>) };
      delete v[prop.id];
      return { ...r, values: v };
    });
    setRows(newRows);
    await patchSchema(newSchema);
  };

  if (loading && !db) {
    return <div className="organize-db-loading">加载数据库中…</div>;
  }
  if (error) {
    return <div className="organize-db-error">⚠️ {error} <button type="button" onClick={() => void load()}>重试</button></div>;
  }
  if (!db) return null;

  return (
    <div className="organize-db-table-wrap">
      <table className="organize-db-table">
        <colgroup>
          <col style={{ width: 32 }} />
          {schema.map((prop) => (
            <col key={prop.id} style={{ width: colWidth(prop.id) }} />
          ))}
          <col style={{ width: 40 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="organize-db-th organize-db-th-gutter"><GripVertical className="h-3.5 w-3.5" /></th>
            {schema.map((prop) => {
              const Meta = TYPE_META[prop.type] || TYPE_META.text;
              const isOpen = activeColumnMenu === prop.id;
              return (
                <th key={prop.id} className="organize-db-th">
                  <div className="organize-db-th-inner" onDoubleClick={() => !readOnly && renameColumn(prop)}>
                    <Meta.icon className="h-3.5 w-3.5" />
                    <span className="organize-db-th-name">{prop.name}</span>
                    {!readOnly && (
                      <button
                        type="button"
                        className={`organize-db-th-menu ${isOpen ? "is-open" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveColumnMenu(isOpen ? null : prop.id);
                        }}
                        title="列设置"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {isOpen && !readOnly && (
                    <div
                      ref={columnMenuRef}
                      className="organize-db-col-menu"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button type="button" className="organize-db-menu-item" onClick={() => { renameColumn(prop); setActiveColumnMenu(null); }}>
                        <Type className="h-3.5 w-3.5" />重命名
                      </button>
                      <div className="organize-db-menu-sep" />
                      <div className="organize-db-menu-label">属性类型</div>
                      {PROPERTY_TYPE_ORDER.map((t) => {
                        const TM = TYPE_META[t];
                        return (
                          <button
                            key={t}
                            type="button"
                            className={`organize-db-menu-item ${prop.type === t ? "is-active" : ""}`}
                            onClick={() => { changeColumnType(prop, t); setActiveColumnMenu(null); }}
                          >
                            <TM.icon className="h-3.5 w-3.5" />
                            {TM.label}
                            {prop.type === t && <Check className="h-3 w-3" />}
                          </button>
                        );
                      })}
                      <div className="organize-db-menu-sep" />
                      <button
                        type="button"
                        className="organize-db-menu-item is-danger"
                        onClick={() => { deleteColumn(prop); setActiveColumnMenu(null); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />删除列
                      </button>
                    </div>
                  )}
                  {!readOnly && (
                    <div
                      className={`organize-db-th-resizer ${dragWidths?.[prop.id] ? "is-resizing" : ""}`}
                      onMouseDown={(e) => startResize(e, prop.id)}
                      onDoubleClick={(e) => { e.stopPropagation(); autoFitColumn(prop.id); }}
                      title="拖动调整列宽 · 双击自适应内容"
                    />
                  )}
                </th>
              );
            })}
            <th className="organize-db-th organize-db-th-add">
              {!readOnly && (
                <div className="organize-db-add-col-wrap">
                  <button type="button" className="organize-db-add-col" onClick={() => addColumn("text")} disabled={saving} title="新增文本列">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={schema.length + 2} className="organize-db-empty-row">
                还没有记录，点击下方「新增行」开始记录
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="organize-db-tr">
                <td className="organize-db-td organize-db-td-gutter">
                  {!readOnly && (
                    <button type="button" className="organize-db-row-delete" onClick={() => deleteRow(row.id)} title="删除行">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </td>
                {schema.map((prop) => {
                  const value = (row.values as Record<string, unknown> | undefined)?.[prop.id];
                  const isEditing = editingCell?.rowId === row.id && editingCell?.propId === prop.id;
                  return (
                    <td
                      key={prop.id}
                      className={`organize-db-td ${prop.type === "checkbox" ? "organize-db-td-checkbox" : ""}`}
                      onClick={() => {
                        if (readOnly) return;
                        if (prop.type === "checkbox") return;
                        setEditingCell({ rowId: row.id, propId: prop.id });
                      }}
                    >
                      {isEditing ? (
                        <CellEditor
                          prop={prop}
                          initialValue={value}
                          onCommit={(v) => updateCell(row.id, prop.id, v)}
                          onCancel={() => setEditingCell(null)}
                        />
                      ) : prop.type === "checkbox" ? (
                        <CheckboxCell
                          readOnly={readOnly}
                          checked={Boolean(value)}
                          onToggle={(v) => updateCell(row.id, prop.id, v)}
                        />
                      ) : (
                        <div className="organize-db-cell">{formatCellDisplay(value, prop)}</div>
                      )}
                    </td>
                  );
                })}
                <td className="organize-db-td organize-db-td-gutter" />
              </tr>
            ))
          )}
        </tbody>
      </table>
      {!readOnly && (
        <div className="organize-db-footer" contentEditable={false}>
          <button type="button" className="organize-db-add-row" onClick={addRow} disabled={saving}>
            <Plus className="h-3.5 w-3.5" />新增行
          </button>
        </div>
      )}
    </div>
  );
}

function CheckboxCell({ checked, onToggle, readOnly }: { checked: boolean; onToggle: (v: boolean) => void; readOnly?: boolean }) {
  return (
    <div
      className="organize-db-cell organize-db-cell-checkbox"
      onClick={(e) => {
        e.stopPropagation();
        if (!readOnly) onToggle(!checked);
      }}
    >
      {checked ? (
        <Check className="h-3.5 w-3.5" style={{ color: "hsl(var(--primary))" }} />
      ) : (
        <div className="organize-db-checkbox-box" />
      )}
    </div>
  );
}

function CellEditor({
  prop,
  initialValue,
  onCommit,
  onCancel,
}: {
  prop: DatabaseProperty;
  initialValue: unknown;
  onCommit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<string>(
    initialValue === null || initialValue === undefined ? "" : String(initialValue)
  );
  const [multiSelectDraft, setMultiSelectDraft] = useState<string[]>(
    Array.isArray(initialValue) ? (initialValue as string[]) : []
  );
  const [selectOpen, setSelectOpen] = useState(prop.type === "select" || prop.type === "multi_select");
  const [newOptionName, setNewOptionName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current && !selectOpen) inputRef.current.focus();
  }, [selectOpen]);

  const commitText = () => {
    let v: unknown = draft;
    if (prop.type === "number") {
      if (draft === "") v = null;
      else {
        const n = Number(draft);
        v = Number.isFinite(n) ? n : draft;
      }
    } else if (draft === "") {
      v = null;
    }
    onCommit(v);
  };

  const commitMultiSelect = (ids: string[]) => {
    onCommit(ids.length ? ids : null);
  };

  const toggleMultiOption = (optId: string) => {
    const next = multiSelectDraft.includes(optId)
      ? multiSelectDraft.filter((x) => x !== optId)
      : [...multiSelectDraft, optId];
    setMultiSelectDraft(next);
  };

  const addOption = () => {
    const name = newOptionName.trim();
    if (!name) return;
    // 新增 option 走特殊路径：先改 schema 加 option，再提交值
    // 但 CellEditor 不知道 schema patching 能力——退而求其次：
    // 直接提交新值为新 id，并通知父级？简化：用 name 作为临时 id，由上层在列类型切换时规整化。
    // 这里简化处理：直接把 name 当作值，由上层 changeColumnType 时扫描整理；
    // 更好的做法需要传 onAddOption——为保持简单，PR-3 先不做 option 动态创建 UI，回车后用文本作为值。
    setDraft(name);
    setNewOptionName("");
    setSelectOpen(false);
    setTimeout(() => onCommit(name), 0);
  };

  if ((prop.type === "select" || prop.type === "multi_select")) {
    const options = prop.options || [];
    if (prop.type === "multi_select") {
      return (
        <div className="organize-db-editor-popup" onMouseDown={(e) => e.stopPropagation()}>
          <div className="organize-db-editor-tags">
            {multiSelectDraft.map((id) => {
              const opt = options.find((o) => o.id === id);
              return (
                <span key={id} className="organize-db-tag" style={opt?.color ? { background: `${opt.color}22`, color: opt.color } : undefined}>
                  {opt ? opt.name : id}
                  <button type="button" className="organize-db-tag-x" onClick={() => toggleMultiOption(id)}>
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
            <input
              ref={inputRef}
              className="organize-db-tag-input"
              value={newOptionName}
              placeholder={options.length ? "搜索或新增选项" : "输入选项名后回车新增"}
              onChange={(e) => setNewOptionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addOption(); }
                if (e.key === "Escape") { e.preventDefault(); onCancel(); }
                if (e.key === "Backspace" && newOptionName === "" && multiSelectDraft.length) {
                  setMultiSelectDraft(multiSelectDraft.slice(0, -1));
                }
              }}
              onBlur={() => commitMultiSelect(multiSelectDraft)}
            />
          </div>
          {options.length > 0 && (
            <div className="organize-db-option-list">
              {options
                .filter((o) => !newOptionName || o.name.toLowerCase().includes(newOptionName.toLowerCase()))
                .map((o) => {
                  const selected = multiSelectDraft.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`organize-db-option-item ${selected ? "is-selected" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); toggleMultiOption(o.id); }}
                    >
                      <span className="organize-db-option-dot" style={{ background: o.color || "hsl(var(--muted-foreground))" }} />
                      {o.name}
                      {selected && <Check className="h-3 w-3" />}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      );
    }
    // select（单选）
    return (
      <div className="organize-db-editor-popup" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="organize-db-input-inside"
          value={draft}
          placeholder="选择或输入新选项"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onCommit(draft || null); }
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          }}
        />
        <div className="organize-db-option-list">
          {options
            .filter((o) => !draft || o.name.toLowerCase().includes(draft.toLowerCase()))
            .map((o) => (
              <button
                key={o.id}
                type="button"
                className={`organize-db-option-item ${draft === o.id || draft === o.name ? "is-selected" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); onCommit(o.id); }}
              >
                <span className="organize-db-option-dot" style={{ background: o.color || "hsl(var(--muted-foreground))" }} />
                {o.name}
              </button>
            ))}
          {draft && !options.some((o) => o.name === draft) && (
            <button
              type="button"
              className="organize-db-option-item is-new"
              onMouseDown={(e) => { e.preventDefault(); onCommit(draft); }}
            >
              <Plus className="h-3 w-3" />新建「{draft}」
            </button>
          )}
        </div>
      </div>
    );
  }

  if (prop.type === "date") {
    return (
      <input
        ref={inputRef}
        autoFocus
        type="date"
        className="organize-db-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft || null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onCommit(draft || null); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
      />
    );
  }

  const inputType = prop.type === "number" ? "number" : prop.type === "url" ? "url" : "text";
  return (
    <input
      ref={inputRef}
      autoFocus={!selectOpen}
      type={inputType}
      className="organize-db-input"
      value={draft}
      placeholder={`输入${TYPE_META[prop.type]?.label || "值"}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitText}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commitText(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
    />
  );
}

export default TableView;
