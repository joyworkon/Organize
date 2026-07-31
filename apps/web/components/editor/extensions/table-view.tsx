"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Plus, Trash2, GripVertical, Type, Hash, CheckSquare, Calendar, Link, List, ListChecks, ChevronDown } from "lucide-react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabasePropertyType } from "@organize/shared";

interface TableViewProps {
  databaseId: string;
}

const TYPE_META: Record<DatabasePropertyType, { icon: typeof Type; label: string }> = {
  text: { icon: Type, label: "文本" },
  number: { icon: Hash, label: "数字" },
  select: { icon: List, label: "单选" },
  multi_select: { icon: ListChecks, label: "多选" },
  checkbox: { icon: CheckSquare, label: "复选框" },
  date: { icon: Calendar, label: "日期" },
  file: { icon: Type, label: "文件" },
  url: { icon: Link, label: "链接" },
};

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSchema(): DatabaseProperty[] {
  return [
    { id: "prop_name", name: "名称", type: "text" },
  ];
}

function renderCellValue(value: unknown, prop: DatabaseProperty): React.ReactNode {
  if (value === null || value === undefined || value === "") return <span className="organize-db-empty">空</span>;
  switch (prop.type) {
    case "checkbox":
      return <input type="checkbox" checked={Boolean(value)} readOnly tabIndex={-1} />;
    case "select": {
      const optId = String(value);
      const opt = (prop.options || []).find((o) => o.id === optId);
      return opt ? <span className="organize-db-tag">{opt.name}</span> : String(value);
    }
    case "multi_select": {
      const ids = Array.isArray(value) ? value : [];
      return (
        <span className="organize-db-tag-list">
          {ids.map((id) => {
            const opt = (prop.options || []).find((o) => o.id === id);
            return <span key={String(id)} className="organize-db-tag">{opt ? opt.name : String(id)}</span>;
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
    case "text":
    default:
      return String(value);
  }
}

export function TableView({ databaseId }: TableViewProps) {
  const [db, setDb] = useState<DatabaseRecord | null>(null);
  const [rows, setRows] = useState<DatabaseRowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; propId: string } | null>(null);
  const [saving, setSaving] = useState(false);

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

  const schema = useMemo<DatabaseProperty[]>(() => {
    if (!db || !Array.isArray(db.schema) || db.schema.length === 0) return defaultSchema();
    return db.schema as DatabaseProperty[];
  }, [db]);

  const addRow = async () => {
    if (saving) return;
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
    if (saving) return;
    if (!window.confirm("确定删除这一行？")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/databases/${databaseId}/rows/${rowId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除行失败");
      setRows((prev) => prev.filter((r) => r.id !== rowId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateCell = async (rowId: string, propId: string, value: unknown) => {
    if (saving) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const newValues = { ...(row.values as Record<string, unknown>), [propId]: value };
    // 乐观更新
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
      // 回滚
      void load();
    } finally {
      setSaving(false);
    }
  };

  const addColumn = async () => {
    if (saving || !db) return;
    const name = window.prompt("列名（默认文本类型）：");
    if (!name) return;
    const newProp: DatabaseProperty = { id: generateId("prop"), name: name.trim(), type: "text" };
    const newSchema = [...schema, newProp];
    setSaving(true);
    try {
      const res = await fetch(`/api/databases/${databaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: newSchema }),
      });
      if (!res.ok) throw new Error("添加列失败");
      const updated = (await res.json()) as DatabaseRecord;
      setDb(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const renameColumn = async (prop: DatabaseProperty) => {
    if (saving || !db) return;
    const name = window.prompt("列名：", prop.name);
    if (!name || name === prop.name) return;
    const newSchema = schema.map((p) => (p.id === prop.id ? { ...p, name: name.trim() } : p));
    setSaving(true);
    try {
      const res = await fetch(`/api/databases/${databaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: newSchema }),
      });
      if (!res.ok) throw new Error("重命名列失败");
      const updated = (await res.json()) as DatabaseRecord;
      setDb(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleColumnTypeMenu = () => {
    // PR-3 简化：类型切换在 PR-4 做更完善，这里不展开
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
        <thead>
          <tr>
            <th className="organize-db-th organize-db-th-gutter"><GripVertical className="h-3.5 w-3.5" /></th>
            {schema.map((prop) => {
              const Meta = TYPE_META[prop.type] || TYPE_META.text;
              return (
                <th key={prop.id} className="organize-db-th" onDoubleClick={() => renameColumn(prop)}>
                  <span className="organize-db-th-inner">
                    <Meta.icon className="h-3.5 w-3.5" />
                    <span className="organize-db-th-name">{prop.name}</span>
                    <button type="button" className="organize-db-th-menu" onClick={toggleColumnTypeMenu} title="列设置">
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </span>
                </th>
              );
            })}
            <th className="organize-db-th organize-db-th-add">
              <button type="button" className="organize-db-add-col" onClick={addColumn} disabled={saving} title="新增列">
                <Plus className="h-3.5 w-3.5" />
              </button>
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
                  <button type="button" className="organize-db-row-delete" onClick={() => deleteRow(row.id)} title="删除行">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
                {schema.map((prop) => {
                  const value = (row.values as Record<string, unknown> | undefined)?.[prop.id];
                  const isEditing = editingCell?.rowId === row.id && editingCell?.propId === prop.id;
                  return (
                    <td
                      key={prop.id}
                      className="organize-db-td"
                      onClick={() => {
                        if (prop.type !== "checkbox") {
                          setEditingCell({ rowId: row.id, propId: prop.id });
                        }
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
                          checked={Boolean(value)}
                          onToggle={(v) => updateCell(row.id, prop.id, v)}
                        />
                      ) : (
                        <div className="organize-db-cell">{renderCellValue(value, prop)}</div>
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
      <div className="organize-db-footer" contentEditable={false}>
        <button type="button" className="organize-db-add-row" onClick={addRow} disabled={saving}>
          <Plus className="h-3.5 w-3.5" />新增行
        </button>
      </div>
    </div>
  );
}

function CheckboxCell({ checked, onToggle }: { checked: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="organize-db-cell organize-db-cell-checkbox" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
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

  const commit = () => {
    let v: unknown = draft;
    if (prop.type === "number") {
      if (draft === "") v = null;
      else {
        const n = Number(draft);
        v = Number.isFinite(n) ? n : draft;
      }
    } else if (prop.type === "checkbox") {
      v = draft === "true";
    } else if (draft === "") {
      v = null;
    }
    onCommit(v);
  };

  if (prop.type === "select" || prop.type === "multi_select") {
    // PR-3 简化：先用 text 输入，用逗号分隔多选
    return (
      <input
        autoFocus
        className="organize-db-input"
        value={draft}
        placeholder={prop.type === "multi_select" ? "逗号分隔多个选项" : "选项 ID"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
      />
    );
  }

  if (prop.type === "date") {
    return (
      <input
        autoFocus
        type="date"
        className="organize-db-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
      />
    );
  }

  const inputType = prop.type === "number" ? "number" : prop.type === "url" ? "url" : "text";
  return (
    <input
      autoFocus
      type={inputType}
      className="organize-db-input"
      value={draft}
      placeholder={`输入${TYPE_META[prop.type]?.label || "值"}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
    />
  );
}

export default TableView;
