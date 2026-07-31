"use client";

import { useMemo } from "react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabaseView } from "@organize/shared";
import { aggregate, type AggregationFn } from "./view-shared/aggregation";

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

type ChartType = "bar_h" | "bar_v" | "line" | "donut";

/** 当 groupByPropId 无效或对应属性不存在时，自动选第一个可分组属性 */
const GROUPABLE_TYPES: DatabaseProperty["type"][] = ["select", "multi_select", "checkbox", "text"];

/** 预设配色（无 option.color 时循环取） */
const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

function pickColor(i: number, explicit?: string): string {
  if (explicit) return explicit;
  return PALETTE[i % PALETTE.length];
}

/** 数字格式化：整数原样、小数保留 1 位 */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

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

/** SVG 自绘：按 type 分派 */
function ChartSvg({
  type,
  results,
}: {
  type: ChartType;
  results: { key: string; label: string; color?: string; value: number }[];
}) {
  if (type === "donut") return <DonutChart results={results} />;
  if (type === "line") return <LineChart results={results} />;
  if (type === "bar_h") return <BarHChart results={results} />;
  return <BarVChart results={results} />;
}

/** 垂直条形图 */
function BarVChart({ results }: { results: { label: string; color?: string; value: number }[] }) {
  const W = 480, H = 260, padL = 40, padB = 40, padT = 20, padR = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(...results.map((r) => r.value), 0);
  const barW = results.length > 0 ? (plotW / results.length) * 0.6 : 0;
  const step = results.length > 0 ? plotW / results.length : plotW;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="垂直条形图">
      {/* Y 轴参考线（3 等分） */}
      {[0, 0.5, 1].map((t) => {
        const y = padT + plotH * (1 - t);
        const v = maxV * t;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="hsl(var(--border))" strokeWidth={1} />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">{fmt(v)}</text>
          </g>
        );
      })}
      {results.map((r, i) => {
        const h = maxV > 0 ? (r.value / maxV) * plotH : 0;
        const x = padL + i * step + (step - barW) / 2;
        const y = padT + plotH - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} fill={pickColor(i, r.color)} rx={2} />
            <text x={x + barW / 2} y={padT + plotH + 14} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">
              {truncate(r.label, 6)}
            </text>
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={10} fill="hsl(var(--foreground))">{fmt(r.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** 水平条形图 */
function BarHChart({ results }: { results: { label: string; color?: string; value: number }[] }) {
  const W = 480, H = 260, padL = 90, padB = 24, padT = 16, padR = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(...results.map((r) => r.value), 0);
  const barH = results.length > 0 ? (plotH / results.length) * 0.6 : 0;
  const step = results.length > 0 ? plotH / results.length : plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="水平条形图">
      {/* X 轴参考线 */}
      {[0, 0.5, 1].map((t) => {
        const x = padL + plotW * t;
        const v = maxV * t;
        return (
          <g key={t}>
            <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="hsl(var(--border))" strokeWidth={1} />
            <text x={x} y={padT + plotH + 14} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">{fmt(v)}</text>
          </g>
        );
      })}
      {results.map((r, i) => {
        const w = maxV > 0 ? (r.value / maxV) * plotW : 0;
        const y = padT + i * step + (step - barH) / 2;
        return (
          <g key={i}>
            <text x={padL - 6} y={y + barH / 2 + 3} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">
              {truncate(r.label, 8)}
            </text>
            <rect x={padL} y={y} width={w} height={barH} fill={pickColor(i, r.color)} rx={2} />
            <text x={padL + w + 4} y={y + barH / 2 + 3} textAnchor="start" fontSize={10} fill="hsl(var(--foreground))">{fmt(r.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** 折线图 */
function LineChart({ results }: { results: { label: string; color?: string; value: number }[] }) {
  const W = 480, H = 260, padL = 40, padB = 40, padT = 20, padR = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(...results.map((r) => r.value), 0);
  const step = results.length > 1 ? plotW / (results.length - 1) : 0;

  const points = results.map((r, i) => {
    const x = results.length > 1 ? padL + i * step : padL + plotW / 2;
    const y = padT + plotH - (maxV > 0 ? (r.value / maxV) * plotH : 0);
    return { x, y, r };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="折线图">
      {/* Y 轴参考线 */}
      {[0, 0.5, 1].map((t) => {
        const y = padT + plotH * (1 - t);
        const v = maxV * t;
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="hsl(var(--border))" strokeWidth={1} />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">{fmt(v)}</text>
          </g>
        );
      })}
      {/* 折线 */}
      {points.length > 1 && (
        <polyline
          fill="none"
          stroke={pickColor(0, results[0]?.color)}
          strokeWidth={2}
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        />
      )}
      {/* 点 + 标签 */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={pickColor(i, p.r.color)} />
          <text x={p.x} y={padT + plotH + 14} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">
            {truncate(p.r.label, 6)}
          </text>
          <text x={p.x} y={p.y - 6} textAnchor="middle" fontSize={10} fill="hsl(var(--foreground))">{fmt(p.r.value)}</text>
        </g>
      ))}
    </svg>
  );
}

/** 环状图（donut） */
function DonutChart({ results }: { results: { label: string; color?: string; value: number }[] }) {
  const size = 240, cx = size / 2, cy = size / 2;
  const r = 90, innerR = 52;
  const total = results.reduce((s, r) => s + r.value, 0);

  // 总和为 0 时无法绘制扇形，显示空环 + 提示
  if (total <= 0) {
    return (
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label="环状图">
        <circle cx={cx} cy={cy} r={(r + innerR) / 2} fill="none" stroke="hsl(var(--muted))" strokeWidth={r - innerR} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fill="hsl(var(--muted-foreground))">无数据</text>
      </svg>
    );
  }

  let acc = 0; // 累积角度（弧度）
  const arcs = results.map((res, i) => {
    const frac = res.value / total;
    const start = acc;
    const end = acc + frac * Math.PI * 2;
    acc = end;
    return { res, i, start, end, frac };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label="环状图">
      {arcs.map(({ res, i, start, end, frac }) => {
        // 单一分组占 100% 时画整环（避免 start==end 产生不可见 path）
        if (frac >= 0.9999) {
          return (
            <circle key={i} cx={cx} cy={cy} r={(r + innerR) / 2} fill="none" stroke={pickColor(i, res.color)} strokeWidth={r - innerR} />
          );
        }
        const d = donutArcPath(cx, cy, r, innerR, start, end);
        return <path key={i} d={d} fill={pickColor(i, res.color)} />;
      })}
      {/* 中心总量 */}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={22} fontWeight={600} fill="hsl(var(--foreground))">{fmt(total)}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">总计</text>
      {/* 图例 */}
      {results.map((res, i) => (
        <g key={`lg-${i}`} transform={`translate(8, ${12 + i * 16})`}>
          <rect width={10} height={10} fill={pickColor(i, res.color)} rx={2} />
          <text x={16} y={9} fontSize={10} fill="hsl(var(--foreground))">{truncate(res.label, 10)}（{fmt(res.value)}）</text>
        </g>
      ))}
    </svg>
  );
}

/** 计算环形扇区路径（用两段弧 + 直线组成闭合路径） */
function donutArcPath(cx: number, cy: number, r: number, innerR: number, start: number, end: number): string {
  const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
  const x3 = cx + innerR * Math.cos(end), y3 = cy + innerR * Math.sin(end);
  const x4 = cx + innerR * Math.cos(start), y4 = cy + innerR * Math.sin(start);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

/** 截断过长标签 */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export default ChartView;
