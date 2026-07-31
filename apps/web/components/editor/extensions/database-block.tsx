"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Database as DatabaseIcon, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState, useCallback, useMemo } from "react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseView } from "@organize/shared";
import { TableView } from "./table-view";
import { ViewSwitcher } from "@/components/database/view-switcher";
import { BoardView } from "@/components/database/board-view";
import { ListView } from "@/components/database/list-view";
import { GalleryView } from "@/components/database/gallery-view";
import { CalendarView } from "@/components/database/calendar-view";
import { TimelineView } from "@/components/database/timeline-view";
import { applyFilters } from "@/components/database/view-shared/filters";
import { applySorts } from "@/components/database/view-shared/sorts";
import type { DatabaseFilter, DatabaseSort } from "@/components/database/view-shared/types";

/**
 * databaseBlock —— 数据库块（atom）
 *
 * attrs:
 *   - databaseId: 关联 db_databases.id（空串 = 未创建的占位）
 *   - viewId:     当前视图 id，默认 "default_view"
 */

function DatabaseBlockView({ node, selected, updateAttributes }: NodeViewProps) {
  const databaseId = String(node.attrs.databaseId || "");
  const [record, setRecord] = useState<DatabaseRecord | null>(null);
  const [rows, setRows] = useState<DatabaseRowRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(databaseId));
  const [error, setError] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState(String(node.attrs.viewId || "default_view"));

  const load = useCallback(async () => {
    if (!databaseId) {
      setRecord(null);
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [dbRes, rowsRes] = await Promise.all([
        fetch(`/api/databases/${encodeURIComponent(databaseId)}`),
        fetch(`/api/databases/${encodeURIComponent(databaseId)}/rows`),
      ]);
      if (!dbRes.ok) throw new Error("加载数据库失败");
      if (!rowsRes.ok) throw new Error("加载行失败");
      setRecord((await dbRes.json()) as DatabaseRecord);
      setRows((await rowsRes.json()) as DatabaseRowRecord[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, [databaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const views: DatabaseView[] = useMemo(() => {
    if (!record || !Array.isArray(record.views) || record.views.length === 0) {
      return [{ id: "default_view", type: "table", config: {} }];
    }
    return record.views as DatabaseView[];
  }, [record]);

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) || views[0],
    [views, activeViewId]
  );

  // 应用视图的筛选和排序
  const processedRows = useMemo(() => {
    if (!record) return rows;
    const schema = Array.isArray(record.schema) ? record.schema : [];
    const filters = (activeView.config.filters || []) as DatabaseFilter[];
    const sorts = (activeView.config.sorts || []) as DatabaseSort[];
    let result = rows;
    if (filters.length) result = applyFilters(result, filters, schema);
    if (sorts.length) result = applySorts(result, sorts, schema);
    return result;
  }, [rows, record, activeView]);

  const patchViews = useCallback(async (newViews: DatabaseView[]) => {
    if (!record) return;
    setRecord({ ...record, views: newViews });
    try {
      await fetch(`/api/databases/${databaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ views: newViews }),
      });
    } catch { /* 静默失败，本地已更新 */ }
  }, [record, databaseId]);

  const handleAddView = useCallback((view: DatabaseView) => {
    patchViews([...views, view]);
  }, [views, patchViews]);

  const handleDeleteView = useCallback((viewId: string) => {
    const newViews = views.filter((v) => v.id !== viewId);
    patchViews(newViews);
    if (activeViewId === viewId && newViews.length) {
      setActiveViewId(newViews[0].id);
    }
  }, [views, activeViewId, patchViews]);

  const handleViewChange = useCallback((viewId: string) => {
    setActiveViewId(viewId);
    updateAttributes({ viewId });
  }, [updateAttributes]);

  // 行操作回调
  const handleAddRow = useCallback(async (defaults?: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/databases/${databaseId}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: defaults || {} }),
      });
      if (!res.ok) throw new Error("添加行失败");
      const newRow = (await res.json()) as DatabaseRowRecord;
      setRows((prev) => [...prev, newRow]);
    } catch { /* ignore */ }
  }, [databaseId]);

  const handleDeleteRow = useCallback(async (rowId: string) => {
    if (!window.confirm("确定删除这一行？")) return;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    try {
      await fetch(`/api/databases/${databaseId}/rows/${rowId}`, { method: "DELETE" });
    } catch { void load(); }
  }, [databaseId, load]);

  const handleUpdateCell = useCallback(async (rowId: string, propId: string, value: unknown) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const newValues = { ...(row.values as Record<string, unknown>), [propId]: value };
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, values: newValues } : r)));
    try {
      await fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: newValues }),
      });
    } catch { void load(); }
  }, [rows, databaseId, load]);

  const handleUpdateRowSort = useCallback(async (rowId: string, newSort: number, groupValue?: unknown) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const newValues = { ...(row.values as Record<string, unknown>) };
    if (groupValue !== undefined && record) {
      // 找到分组属性 id
      const schema = Array.isArray(record.schema) ? record.schema : [];
      const groupProp = schema.find((p) => p.type === "select" || p.type === "multi_select");
      if (groupProp) newValues[groupProp.id] = groupValue;
    }
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, sort: newSort, values: newValues } : r)));
    try {
      await fetch(`/api/databases/${databaseId}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort: newSort, values: newValues }),
      });
    } catch { void load(); }
  }, [rows, databaseId, record, load]);

  const title = record?.title || (loading ? "加载中…" : "未命名数据库");
  const icon = record?.icon || "";
  const parentNoteId = record?.parent_note_id;
  const isFullPageLinked = Boolean(parentNoteId);

  const renderView = () => {
    if (!record) return null;
    switch (activeView.type) {
      case "board":
        return (
          <BoardView
            databaseId={databaseId}
            db={record}
            rows={processedRows}
            view={activeView}
            onUpdateCell={handleUpdateCell}
            onAddRow={handleAddRow}
            onUpdateRowSort={handleUpdateRowSort}
          />
        );
      case "list":
        return (
          <ListView
            databaseId={databaseId}
            db={record}
            rows={processedRows}
            view={activeView}
            onAddRow={() => handleAddRow()}
            onDeleteRow={handleDeleteRow}
            onUpdateCell={handleUpdateCell}
          />
        );
      case "gallery":
        return (
          <GalleryView
            databaseId={databaseId}
            db={record}
            rows={processedRows}
            view={activeView}
            onAddRow={() => handleAddRow()}
            onDeleteRow={handleDeleteRow}
          />
        );
      case "calendar":
        return (
          <CalendarView
            databaseId={databaseId}
            db={record}
            rows={processedRows}
            view={activeView}
            onAddRow={handleAddRow}
          />
        );
      case "timeline":
        return (
          <TimelineView
            databaseId={databaseId}
            db={record}
            rows={processedRows}
            view={activeView}
          />
        );
      case "table":
      default:
        return <TableView databaseId={databaseId} />;
    }
  };

  return (
    <NodeViewWrapper
      className={selected ? "organize-database-block is-selected" : "organize-database-block"}
      data-database-block=""
      data-database-id={databaseId}
      as="div"
    >
      <div className="organize-database-header" contentEditable={false}>
        <span className="organize-database-badge">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseIcon className="h-3.5 w-3.5" />}
          {icon ? <span className="organize-database-icon">{icon}</span> : null}
          <span className="organize-database-title">{title}</span>
        </span>
        {isFullPageLinked && (
          <a
            className="organize-database-open"
            href={`/notes/${parentNoteId}`}
            title="在新页面打开"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />打开
          </a>
        )}
      </div>
      {record && views.length > 0 && (
        <ViewSwitcher
          views={views}
          activeViewId={activeView.id}
          onViewChange={handleViewChange}
          onAddView={handleAddView}
          onDeleteView={handleDeleteView}
        />
      )}
      <div className="organize-database-body" contentEditable={false}>
        {error ? (
          <div className="organize-database-placeholder">
            <p className="organize-database-error">⚠️ {error}</p>
          </div>
        ) : loading || !databaseId ? (
          <div className="organize-database-placeholder">
            <p>正在加载数据库…</p>
          </div>
        ) : (
          renderView()
        )}
      </div>
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    databaseBlock: {
      insertDatabaseBlock: (attrs: { databaseId: string; viewId?: string }) => ReturnType;
    };
  }
}

export const DatabaseBlock = Node.create({
  name: "databaseBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      databaseId: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-database-id") || "",
        renderHTML: (attrs) => {
          const v = String(attrs.databaseId || "");
          return v ? { "data-database-id": v } : {};
        },
      },
      viewId: {
        default: "default_view",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-view-id") || "default_view",
        renderHTML: (attrs) => ({ "data-view-id": String(attrs.viewId || "default_view") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-database-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-database-block": "" })];
  },

  addCommands() {
    return {
      insertDatabaseBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              databaseId: attrs.databaseId || "",
              viewId: attrs.viewId || "default_view",
            },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView);
  },
});

export default DatabaseBlock;
