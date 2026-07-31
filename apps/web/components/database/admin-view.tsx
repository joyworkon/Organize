"use client";

import { useMemo, useState, useCallback } from "react";
import {
  Plus, Trash2, GripVertical, Pencil, Check,
  LayoutDashboard, BarChart3,
} from "lucide-react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabaseView } from "@organize/shared";
import { aggregate, type AggregationFn, type AggregationResult } from "./view-shared/aggregation";
import { ChartSvg, type ChartType, fmt } from "./chart-svg";

/** 管理面板里的一个块 */
interface AdminWidget {
  id: string;
  type: "metric" | "chart";
  title?: string;
  /** 聚合方式（metric / chart 共用） */
  metric?: AggregationFn;
  /** 分组属性 id */
  groupByPropId?: string;
  /** sum/avg 时的数值属性 id */
  valuePropId?: string;
  /** chart 块的图表类型 */
  chartType?: ChartType;
}

/** 可分组属性类型 */
const GROUPABLE_TYPES: DatabaseProperty["type"][] = ["select", "multi_select", "checkbox", "text"];

function genId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

interface AdminViewProps {
  databaseId: string;
  db: DatabaseRecord;
  rows: DatabaseRowRecord[];
  view: DatabaseView;
  readOnly?: boolean;
  /** 行操作回调（面板只读，收下但不调用） */
  onUpdateCell: (rowId: string, propId: string, value: unknown) => void;
  onAddRow: (defaults?: Record<string, unknown>) => void;
  onUpdateRowSort: (rowId: string, newSort: number, groupValue?: unknown) => void;
  /** 更新当前视图 config（持久化由父层 patchViews 负责） */
  onUpdateViewConfig?: (patch: Record<string, unknown>) => void;
}

export function AdminView({
  db,
  rows,
  view,
  readOnly = false,
  onUpdateViewConfig,
}: AdminViewProps) {
  const schema = useMemo<DatabaseProperty[]>(
    () => (Array.isArray(db.schema) && db.schema.length ? db.schema : []),
    [db.schema]
  );

  const config = view.config as Record<string, unknown>;
  const widgets = (Array.isArray(config.widgets) ? config.widgets : []) as AdminWidget[];

  const groupableProps = schema.filter((p) => GROUPABLE_TYPES.includes(p.type));
  const numberProps = schema.filter((p) => p.type === "number");

  const updateWidgets = useCallback((newWidgets: AdminWidget[]) => {
    if (readOnly || !onUpdateViewConfig) return;
    onUpdateViewConfig({ widgets: newWidgets });
  }, [readOnly, onUpdateViewConfig]);

  // ---- 拖拽排序（参照 board-view.tsx 的 HTML5 DnD） ----
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(id);
  };
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const srcId = e.dataTransfer.getData("text/plain") || draggedId;
    if (!srcId || srcId === targetId) {
      setDraggedId(null);
      return;
    }
    const srcIdx = widgets.findIndex((w) => w.id === srcId);
    const tgtIdx = widgets.findIndex((w) => w.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) {
      setDraggedId(null);
      return;
    }
    const next = [...widgets];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(tgtIdx, 0, moved);
    updateWidgets(next);
    setDraggedId(null);
  };

  // ---- 增删改 ----
  const addWidget = (type: AdminWidget["type"]) => {
    const defaultGroup = groupableProps[0]?.id || "";
    const w: AdminWidget = {
      id: genId(),
      type,
      title: type === "metric" ? "新指标卡" : "新图表",
      metric: "count",
      groupByPropId: defaultGroup,
      chartType: type === "chart" ? "bar_v" : undefined,
    };
    updateWidgets([...widgets, w]);
  };
  const deleteWidget = (id: string) => updateWidgets(widgets.filter((w) => w.id !== id));
  const patchWidget = (id: string, patch: Partial<AdminWidget>) =>
    updateWidgets(widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  // ---- 空面板 ----
  if (widgets.length === 0) {
    return (
      <div className="organize-db-admin-empty">
        <LayoutDashboard className="organize-db-admin-empty-icon" />
        <p>这是一个管理面板——把指标卡和图表块摆进来，一眼看全库统计。</p>
        {!readOnly && (
          <div className="organize-db-admin-add-row">
            <button type="button" className="organize-db-admin-add-btn" onClick={() => addWidget("metric")}>
              <Plus className="h-3.5 w-3.5" /> 指标卡
            </button>
            <button type="button" className="organize-db-admin-add-btn" onClick={() => addWidget("chart")}>
              <Plus className="h-3.5 w-3.5" /> 图表块
            </button>
          </div>
        )}
        {groupableProps.length === 0 && <p className="organize-db-admin-hint">提示：需要至少一个「单选/多选/复选/文本」属性才能聚合。</p>}
      </div>
    );
  }

  return (
    <div className="organize-db-admin">
      <div className="organize-db-admin-grid">
        {widgets.map((w) => (
          <WidgetCard
            key={w.id}
            widget={w}
            rows={rows}
            schema={schema}
            groupableProps={groupableProps}
            numberProps={numberProps}
            readOnly={readOnly}
            isDragging={draggedId === w.id}
            isDragOver={dragOverId === w.id}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
            onDelete={() => deleteWidget(w.id)}
            onPatch={(patch) => patchWidget(w.id, patch)}
          />
        ))}
      </div>
      {!readOnly && (
        <div className="organize-db-admin-add-row">
          <button type="button" className="organize-db-admin-add-btn" onClick={() => addWidget("metric")}>
            <Plus className="h-3.5 w-3.5" /> 指标卡
          </button>
          <button type="button" className="organize-db-admin-add-btn" onClick={() => addWidget("chart")}>
            <Plus className="h-3.5 w-3.5" /> 图表块
          </button>
        </div>
      )}
    </div>
  );
}

/** 单个块卡片 */
function WidgetCard({
  widget,
  rows,
  schema,
  groupableProps,
  numberProps,
  readOnly,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onDelete,
  onPatch,
}: {
  widget: AdminWidget;
  rows: DatabaseRowRecord[];
  schema: DatabaseProperty[];
  groupableProps: DatabaseProperty[];
  numberProps: DatabaseProperty[];
  readOnly: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDelete: () => void;
  onPatch: (patch: Partial<AdminWidget>) => void;
}) {
  const [editing, setEditing] = useState(false);

  // 聚合（metric / chart 共用）
  const results: AggregationResult[] = useMemo(() => {
    const groupBy = widget.groupByPropId || groupableProps[0]?.id || "";
    const needValue = (widget.metric === "sum" || widget.metric === "avg");
    if (!groupBy || rows.length === 0) return [];
    if (needValue && !(widget.valuePropId || numberProps[0]?.id)) return [];
    return aggregate(
      rows,
      {
        groupByPropId: groupBy,
        metric: widget.metric || "count",
        valuePropId: needValue ? (widget.valuePropId || numberProps[0]?.id) : undefined,
      },
      schema
    );
  }, [rows, widget, schema, groupableProps, numberProps]);

  // 指标卡：聚合结果的总和（count 全库行数；sum/avg 各组之和）
  const metricValue = results.reduce((s, r) => s + r.value, 0);
  const metricLabel = widget.metric === "count" ? "条记录"
    : widget.metric === "sum" ? "合计"
      : "平均（按组）";

  return (
    <div
      className={`organize-db-admin-card ${isDragging ? "is-dragging" : ""} ${isDragOver ? "is-drag-over" : ""}`}
      draggable={!readOnly}
      onDragStart={(e) => onDragStart(e, widget.id)}
      onDragOver={(e) => onDragOver(e, widget.id)}
      onDrop={(e) => onDrop(e, widget.id)}
      onDragEnd={onDragEnd}
    >
      <div className="organize-db-admin-card-head">
        {!readOnly && <GripVertical className="organize-db-admin-grip" />}
        <span className="organize-db-admin-card-type">
          {widget.type === "metric" ? <BarChart3 className="h-3 w-3" /> : <LayoutDashboard className="h-3 w-3" />}
        </span>
        <span className="organize-db-admin-card-title">{widget.title || (widget.type === "metric" ? "指标卡" : "图表")}</span>
        {!readOnly && (
          <div className="organize-db-admin-card-actions">
            <button type="button" title="编辑" onClick={() => setEditing(!editing)}>
              {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            </button>
            <button type="button" title="删除" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing && !readOnly ? (
        <WidgetEditor
          widget={widget}
          groupableProps={groupableProps}
          numberProps={numberProps}
          onPatch={onPatch}
        />
      ) : (
        <div className="organize-db-admin-card-body">
          {widget.type === "metric" ? (
            <div className="organize-db-admin-metric">
              <span className="organize-db-admin-metric-num">{fmt(metricValue)}</span>
              <span className="organize-db-admin-metric-label">{metricLabel}</span>
            </div>
          ) : results.length > 0 ? (
            <ChartSvg type={widget.chartType || "bar_v"} results={results} />
          ) : (
            <div className="organize-db-admin-placeholder">
              {rows.length === 0 ? "暂无记录" : "无可用数据（编辑配置聚合属性）"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 块编辑表单（内联，不引新库） */
function WidgetEditor({
  widget,
  groupableProps,
  numberProps,
  onPatch,
}: {
  widget: AdminWidget;
  groupableProps: DatabaseProperty[];
  numberProps: DatabaseProperty[];
  onPatch: (patch: Partial<AdminWidget>) => void;
}) {
  const metric = widget.metric || "count";
  const needValue = metric === "sum" || metric === "avg";
  return (
    <div className="organize-db-admin-editor">
      <label className="organize-db-admin-field">
        <span>标题</span>
        <input
          type="text"
          value={widget.title || ""}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder="块标题"
        />
      </label>
      {widget.type === "chart" && (
        <label className="organize-db-admin-field">
          <span>图表</span>
          <select
            value={widget.chartType || "bar_v"}
            onChange={(e) => onPatch({ chartType: e.target.value as ChartType })}
          >
            <option value="bar_v">垂直条形</option>
            <option value="bar_h">水平条形</option>
            <option value="line">折线</option>
            <option value="donut">环状</option>
          </select>
        </label>
      )}
      <label className="organize-db-admin-field">
        <span>分组</span>
        <select
          value={widget.groupByPropId || groupableProps[0]?.id || ""}
          onChange={(e) => onPatch({ groupByPropId: e.target.value })}
          disabled={groupableProps.length === 0}
        >
          {groupableProps.length === 0 ? (
            <option value="">无可分组属性</option>
          ) : (
            groupableProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)
          )}
        </select>
      </label>
      <label className="organize-db-admin-field">
        <span>聚合</span>
        <select
          value={metric}
          onChange={(e) => {
            const m = e.target.value as AggregationFn;
            if (m === "count") onPatch({ metric: m, valuePropId: undefined });
            else onPatch({ metric: m, valuePropId: widget.valuePropId || numberProps[0]?.id });
          }}
          disabled={metric !== "count" && numberProps.length === 0}
        >
          <option value="count">计数</option>
          <option value="sum">求和</option>
          <option value="avg">平均</option>
        </select>
      </label>
      {needValue && numberProps.length > 0 && (
        <label className="organize-db-admin-field">
          <span>数值</span>
          <select
            value={widget.valuePropId || numberProps[0]?.id || ""}
            onChange={(e) => onPatch({ valuePropId: e.target.value })}
          >
            {numberProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

export default AdminView;
