"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabaseView } from "@organize/shared";

interface ListViewProps {
  databaseId: string;
  db: DatabaseRecord;
  rows: DatabaseRowRecord[];
  view: DatabaseView;
  readOnly?: boolean;
  onAddRow: () => void;
  onDeleteRow: (rowId: string) => void;
  onUpdateCell: (rowId: string, propId: string, value: unknown) => void;
}

export function ListView({
  db,
  rows,
  view,
  readOnly = false,
  onAddRow,
  onDeleteRow,
  onUpdateCell,
}: ListViewProps) {
  const schema = useMemo<DatabaseProperty[]>(
    () => (Array.isArray(db.schema) && db.schema.length ? db.schema : [{ id: "prop_name", name: "名称", type: "text" }]),
    [db.schema]
  );

  const hiddenProps = (view.config.hiddenProps as string[]) || [];
  const visibleSchema = schema.filter((p) => !hiddenProps.includes(p.id));
  const titleProp = visibleSchema.find((p) => p.type === "text") || visibleSchema[0];
  const secondaryProps = visibleSchema.filter((p) => p.id !== titleProp.id).slice(0, 3);

  return (
    <div className="organize-db-list">
      {rows.length === 0 ? (
        <div className="organize-db-list-empty">暂无记录</div>
      ) : (
        <div className="organize-db-list-items">
          {rows.map((row) => {
            const values = (row.values || {}) as Record<string, unknown>;
            const title = values[titleProp.id];
            return (
              <div key={row.id} className="organize-db-list-item">
                {!readOnly && (
                  <button
                    type="button"
                    className="organize-db-list-delete"
                    onClick={() => onDeleteRow(row.id)}
                    title="删除行"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <div className="organize-db-list-item-main">
                  <span className="organize-db-list-item-title">
                    {title ? String(title) : "未命名"}
                  </span>
                  <div className="organize-db-list-item-props">
                    {secondaryProps.map((prop) => {
                      const v = values[prop.id];
                      if (v === null || v === undefined || v === "") return null;
                      let display: string;
                      if (prop.type === "checkbox") display = v ? "✓" : "✗";
                      else if (prop.type === "select") {
                        const opt = (prop.options || []).find((o) => o.id === v);
                        display = opt?.name || String(v);
                      } else if (prop.type === "multi_select") {
                        const ids = Array.isArray(v) ? (v as string[]) : [];
                        display = ids.map((id) => (prop.options || []).find((o) => o.id === id)?.name || id).join(", ");
                      } else {
                        display = String(v);
                      }
                      return (
                        <span key={prop.id} className="organize-db-list-item-prop">
                          <span className="organize-db-list-prop-name">{prop.name}:</span> {display}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!readOnly && (
        <button type="button" className="organize-db-add-row" onClick={onAddRow}>
          <Plus className="h-3.5 w-3.5" />新增行
        </button>
      )}
    </div>
  );
}

export default ListView;
