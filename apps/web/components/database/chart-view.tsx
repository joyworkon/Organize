"use client";

import { useMemo } from "react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabaseView } from "@organize/shared";
import { aggregate, type AggregationFn } from "./view-shared/aggregation";
import { ChartSvg, type ChartType } from "./chart-svg";

interface ChartViewProps {
  databaseId: string;
  db: DatabaseRecord;
  rows: DatabaseRowRecord[];
  view: DatabaseView;
  readOnly?: boolean;
  /** 行编辑回调（图表只读，收下但不调用） */
  onUpdateCell: (rowId: string, propId: string, value: unknown) => void;
  /** 新增行回调（图表只读，收下但不调用） */
  onAddRow: (defaults?: Record<string, unknown>) => void;
  /** 拖拽排序回调（图表只读，收下但不调用） */
  onUpdateRowSort: (rowId: string, newSort: number, groupValue?: unknown) => void;
  /** 更新当前视图 config（持久化由父层 patchViews 负责） */
  onUpdateViewConfig?: (patch: Record<string, unknown>) => void;
}

/** 当 groupByPropId 无效或对应属性不存在时，自动选第一个可分组属性 */
const GROUPABLE_TYPES: DatabaseProperty["type"][] = ["select", "multi_select", "checkbox", "text"];

export function ChartView({
  db,
  rows,
  view,
  readOnly = false,
  onUpdateViewConfig,
}: ChartViewProps) {
  const schema = useMemo<DatabaseProperty[]>(
    () => (Array.isArray(db.schema) && db.schema.length ? db.schema : []),
    [db.schema]
  );

  const config = view.config as Record<string, unknown>;
  const chartType = (config.chartType as ChartType) || "bar_v";
  const groupByPropId = (config.groupByPropId as string) || "";
  const metric = (config.metric as AggregationFn) || "count";
  const valuePropId = (config.valuePropId as string) || "";

  // 自动选第一个可分组属性 / 第一个数值属性
  const defaultGroupProp = schema.find((p) => GROUPABLE_TYPES.includes(p.type));
  const effectiveGroupBy = groupByPropId || defaultGroupProp?.id || "";
  const numberProps = schema.filter((p) => p.type === "number");

  const updateConfig = (patch: Record<string, unknown>) => {
    if (readOnly || !onUpdateViewConfig) return;
    onUpdateViewConfig(patch);
  };

  // 聚合
  const results = useMemo(() => {
    if (!effectiveGroupBy || rows.length === 0) return [];
    if ((metric === "sum" || metric === "avg") && !valuePropId) return [];
    return aggregate(
      rows,
      { groupByPropId: effectiveGroupBy, metric, valuePropId: valuePropId || undefined },
      schema
    );
  }, [rows, effectiveGroupBy, metric, valuePropId, schema]);

  const groupableProps = schema.filter((p) => GROUPABLE_TYPES.includes(p.type));

  // 占位：无可用分组属性 / 无数据
  const noGroupProp = groupableProps.length === 0;
  const needValue = (metric === "sum" || metric === "avg") && numberProps.length === 0;

  return (
    <div className="organize-db-chart">
      {/* 配置条 */}
      {!readOnly && (
        <div className="organize-db-chart-config">
          <label className="organize-db-chart-field">
            <span>类型</span>
            <select
              value={chartType}
              onChange={(e) => updateConfig({ chartType: e.target.value })}
            >
              <option value="bar_v">垂直条形</option>
              <option value="bar_h">水平条形</option>
              <option value="line">折线</option>
              <option value="donut">环状</option>
            </select>
          </label>
          <label className="organize-db-chart-field">
            <span>分组</span>
            <select
              value={effectiveGroupBy}
              onChange={(e) => updateConfig({ groupByPropId: e.target.value })}
              disabled={noGroupProp}
            >
              {noGroupProp ? (
                <option value="">无可分组属性</option>
              ) : (
                groupableProps.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))
              )}
            </select>
          </label>
          <label className="organize-db-chart-field">
            <span>聚合</span>
            <select
              value={metric}
              onChange={(e) => {
                const m = e.target.value as AggregationFn;
                // 切到 count 时清掉 valuePropId；切到 sum/avg 时默认选第一个数值属性
                if (m === "count") {
                  updateConfig({ metric: m, valuePropId: "" });
                } else {
                  updateConfig({ metric: m, valuePropId: valuePropId || numberProps[0]?.id || "" });
                }
              }}
              disabled={needValue}
            >
              <option value="count">计数</option>
              <option value="sum">求和</option>
              <option value="avg">平均</option>
            </select>
          </label>
          {(metric === "sum" || metric === "avg") && numberProps.length > 0 && (
            <label className="organize-db-chart-field">
              <span>数值</span>
              <select
                value={valuePropId}
                onChange={(e) => updateConfig({ valuePropId: e.target.value })}
              >
                {numberProps.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* 图表区 */}
      <div className="organize-db-chart-canvas">
        {noGroupProp ? (
          <EmptyHint text="需要至少一个「单选/多选/复选/文本」属性来分组。" />
        ) : needValue ? (
          <EmptyHint text="求和/平均需要一个「数字」类型的属性。" />
        ) : results.length === 0 ? (
          <EmptyHint text={rows.length === 0 ? "暂无记录" : "无可用数据（请选择分组与数值属性）"} />
        ) : (
          <ChartSvg type={chartType} results={results} />
        )}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="organize-db-chart-empty">
      <p>{text}</p>
    </div>
  );
}

export default ChartView;
