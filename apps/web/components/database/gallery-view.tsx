"use client";

import { useMemo } from "react";
import { Plus, Trash2, Image as ImageIcon } from "lucide-react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabaseView } from "@organize/shared";

interface GalleryViewProps {
  databaseId: string;
  db: DatabaseRecord;
  rows: DatabaseRowRecord[];
  view: DatabaseView;
  readOnly?: boolean;
  onAddRow: () => void;
  onDeleteRow: (rowId: string) => void;
}

export function GalleryView({
  db,
  rows,
  view,
  readOnly = false,
  onAddRow,
  onDeleteRow,
}: GalleryViewProps) {
  const schema = useMemo<DatabaseProperty[]>(
    () => (Array.isArray(db.schema) && db.schema.length ? db.schema : [{ id: "prop_name", name: "名称", type: "text" }]),
    [db.schema]
  );

  const cardSize = (view.config.cardSize as "small" | "medium" | "large") || "medium";
  const titleProp = schema.find((p) => p.type === "text") || schema[0];
  // 封面：第一个 file 属性或 url 属性（当作图片链接）
  const coverProp = schema.find((p) => p.type === "file") || schema.find((p) => p.type === "url");
  const secondaryProps = schema.filter((p) => p.id !== titleProp.id && p.id !== coverProp?.id && p.type !== "file").slice(0, 2);

  const gridClass = cardSize === "small"
    ? "organize-db-gallery-grid-sm"
    : cardSize === "large"
      ? "organize-db-gallery-grid-lg"
      : "organize-db-gallery-grid-md";

  return (
    <div className="organize-db-gallery">
      {rows.length === 0 ? (
        <div className="organize-db-gallery-empty">暂无记录</div>
      ) : (
        <div className={`organize-db-gallery-grid ${gridClass}`}>
          {rows.map((row) => {
            const values = (row.values || {}) as Record<string, unknown>;
            const title = values[titleProp.id];
            const coverUrl = coverProp ? values[coverProp.id] : null;
            return (
              <div key={row.id} className="organize-db-gallery-card">
                <div className="organize-db-gallery-cover">
                  {coverUrl && typeof coverUrl === "string" && coverUrl.startsWith("http") ? (
                    <img src={coverUrl} alt="" className="organize-db-gallery-img" loading="lazy" />
                  ) : (
                    <div className="organize-db-gallery-img-placeholder">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      className="organize-db-gallery-delete"
                      onClick={() => onDeleteRow(row.id)}
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="organize-db-gallery-body">
                  <span className="organize-db-gallery-title">
                    {title ? String(title) : "未命名"}
                  </span>
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
                      <span key={prop.id} className="organize-db-gallery-prop">
                        <span className="organize-db-gallery-prop-name">{prop.name}:</span> {display}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!readOnly && (
        <button type="button" className="organize-db-add-row" onClick={onAddRow}>
          <Plus className="h-3.5 w-3.5" />新增卡片
        </button>
      )}
    </div>
  );
}

export default GalleryView;
