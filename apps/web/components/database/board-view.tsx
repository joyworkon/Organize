"use client";

import { useState, useMemo } from "react";
import { Plus, GripVertical } from "lucide-react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabaseView } from "@organize/shared";
import { groupBySelectProperty, UNGROUPED_KEY } from "./view-shared/grouping";

interface BoardViewProps {
  databaseId: string;
  db: DatabaseRecord;
  rows: DatabaseRowRecord[];
  view: DatabaseView;
  readOnly?: boolean;
  onUpdateCell: (rowId: string, propId: string, value: unknown) => void;
  onAddRow: (defaults?: Record<string, unknown>) => void;
  onUpdateRowSort: (rowId: string, newSort: number, groupValue?: unknown) => void;
}

export function BoardView({
  databaseId,
  db,
  rows,
  view,
  readOnly = false,
  onUpdateCell,
  onAddRow,
  onUpdateRowSort,
}: BoardViewProps) {
  const [draggedRow, setDraggedRow] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const schema = useMemo<DatabaseProperty[]>(
    () => (Array.isArray(db.schema) && db.schema.length ? db.schema : [{ id: "prop_name", name: "名称", type: "text" }]),
    [db.schema]
  );

  // 找到用于分组的 select 属性
  const groupByPropId = useMemo(() => {
    if (view.config.groupBy) return view.config.groupBy as string;
    // 自动选第一个 select 属性
    const sel = schema.find((p) => p.type === "select");
    return sel?.id || "";
  }, [view.config.groupBy, schema]);

  const groupProp = schema.find((p) => p.id === groupByPropId);

  const groups = useMemo(
    () => groupBySelectProperty(rows, groupByPropId, schema),
    [rows, groupByPropId, schema]
  );

  // 标题属性（第一个 text 类型）
  const titleProp = useMemo(
    () => schema.find((p) => p.type === "text") || schema[0],
    [schema]
  );

  const handleDragStart = (e: React.DragEvent, rowId: string) => {
    setDraggedRow(rowId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", rowId);
  };

  const handleDragOver = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnKey);
  };

  const handleDrop = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    const rowId = e.dataTransfer.getData("text/plain") || draggedRow;
    if (!rowId || readOnly) return;

    // 计算新 sort（放到该列末尾）
    const targetGroup = groups.find((g) => g.key === columnKey);
    const maxSort = targetGroup && targetGroup.rows.length
      ? Math.max(...targetGroup.rows.map((r) => r.sort))
      : 0;

    // 更新分组值
    let groupValue: unknown = undefined;
    if (columnKey !== UNGROUPED_KEY && groupProp) {
      groupValue = groupProp.type === "multi_select" ? [columnKey] : columnKey;
    } else if (columnKey === UNGROUPED_KEY && groupProp) {
      groupValue = groupProp.type === "multi_select" ? [] : null;
    }

    onUpdateRowSort(rowId, maxSort + 1, groupValue);
    setDraggedRow(null);
  };

  const handleDragEnd = () => {
    setDraggedRow(null);
    setDragOverColumn(null);
  };

  if (!groupProp || (groupProp.type !== "select" && groupProp.type !== "multi_select")) {
    return (
      <div className="organize-db-board-empty">
        <p>看板视图需要一个「单选」属性来分栏。</p>
        <p className="organize-db-board-hint">请在表格视图中添加一个单选类型的列。</p>
      </div>
    );
  }

  return (
    <div className="organize-db-board">
      {groups.map((group) => (
        <div
          key={group.key}
          className={`organize-db-board-column ${dragOverColumn === group.key ? "is-drag-over" : ""}`}
          onDragOver={(e) => handleDragOver(e, group.key)}
          onDrop={(e) => handleDrop(e, group.key)}
          onDragLeave={() => setDragOverColumn(null)}
        >
          <div className="organize-db-board-col-header">
            <span
              className="organize-db-board-col-dot"
              style={{ background: group.color || "hsl(var(--muted-foreground))" }}
            />
            <span className="organize-db-board-col-title">{group.label}</span>
            <span className="organize-db-board-col-count">{group.rows.length}</span>
          </div>
          <div className="organize-db-board-col-body">
            {group.rows.map((row) => {
              const values = (row.values || {}) as Record<string, unknown>;
              const title = values[titleProp.id];
              return (
                <div
                  key={row.id}
                  className={`organize-db-board-card ${draggedRow === row.id ? "is-dragging" : ""}`}
                  draggable={!readOnly}
                  onDragStart={(e) => handleDragStart(e, row.id)}
                  onDragEnd={handleDragEnd}
                >
                  {!readOnly && <GripVertical className="h-3 w-3 organize-db-board-grip" />}
                  <div className="organize-db-board-card-content">
                    <span className="organize-db-board-card-title">
                      {title ? String(title) : "未命名"}
                    </span>
                    {/* 显示其他非分组属性摘要 */}
                    <CardProperties row={row} schema={schema} skipPropIds={[groupByPropId, titleProp.id]} />
                  </div>
                </div>
              );
            })}
            {!readOnly && (
              <button
                type="button"
                className="organize-db-board-add-card"
                onClick={() => {
                  const defaults: Record<string, unknown> = {};
                  if (group.key !== UNGROUPED_KEY) {
                    defaults[groupByPropId] = groupProp.type === "multi_select" ? [group.key] : group.key;
                  }
                  onAddRow(defaults);
                }}
              >
                <Plus className="h-3 w-3" />新增
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 卡片内显示次要属性 */
function CardProperties({
  row,
  schema,
  skipPropIds,
}: {
  row: DatabaseRowRecord;
  schema: DatabaseProperty[];
  skipPropIds: string[];
}) {
  const values = (row.values || {}) as Record<string, unknown>;
  const displayProps = schema.filter(
    (p) => !skipPropIds.includes(p.id) && p.type !== "file"
  ).slice(0, 3); // 最多显示 3 个

  const items = displayProps
    .map((p) => {
      const v = values[p.id];
      if (v === null || v === undefined || v === "") return null;
      let display: string;
      if (p.type === "checkbox") display = v ? "✓" : "✗";
      else if (p.type === "multi_select") {
        const ids = Array.isArray(v) ? (v as string[]) : [];
        display = ids
          .map((id) => (p.options || []).find((o) => o.id === id)?.name || id)
          .join(", ");
      } else if (p.type === "select") {
        display = (p.options || []).find((o) => o.id === v)?.name || String(v);
      } else {
        display = String(v);
      }
      return { propId: p.id, label: display };
    })
    .filter(Boolean) as { propId: string; label: string }[];

  if (!items.length) return null;

  return (
    <div className="organize-db-board-card-props">
      {items.map((item) => (
        <span key={item.propId} className="organize-db-board-card-prop">{item.label}</span>
      ))}
    </div>
  );
}

export default BoardView;
