"use client";

/**
 * 共享 SVG 图表组件 —— 图表视图（chart-view）与管理面板（admin-view）共用。
 *
 * 从 chart-view.tsx 抽出，保证图表视图渲染行为零变化。
 * 4 个图表子组件（BarV/BarH/Line/Donut）+ ChartSvg 分派器 + 配色/格式化工具。
 */
import type { AggregationResult } from "./view-shared/aggregation";

export type ChartType = "bar_h" | "bar_v" | "line" | "donut";

/** 预设配色（无 option.color 时循环取） */
export const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

export function pickColor(i: number, explicit?: string): string {
  if (explicit) return explicit;
  return PALETTE[i % PALETTE.length];
}

/** 数字格式化：整数原样、小数保留 1 位 */
export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 截断过长标签 */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** SVG 自绘：按 type 分派（管理面板复用入口） */
export function ChartSvg({
  type,
  results,
}: {
  type: ChartType;
  results: AggregationResult[];
}) {
  if (type === "donut") return <DonutChart results={results} />;
  if (type === "line") return <LineChart results={results} />;
  if (type === "bar_h") return <BarHChart results={results} />;
  return <BarVChart results={results} />;
}

/** 垂直条形图 */
export function BarVChart({ results }: { results: { label: string; color?: string; value: number }[] }) {
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
export function BarHChart({ results }: { results: { label: string; color?: string; value: number }[] }) {
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
export function LineChart({ results }: { results: { label: string; color?: string; value: number }[] }) {
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
export function DonutChart({ results }: { results: { label: string; color?: string; value: number }[] }) {
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
