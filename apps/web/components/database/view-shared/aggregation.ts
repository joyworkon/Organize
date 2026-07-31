/**
 * 聚合求值器 —— 图表视图 / 管理面板共用
 *
 * 按 groupBy 属性把行分组，再对每组算一个度量值（count / sum / avg）。
 * 纯函数，无 React 无 IO。
 */
import type { DatabaseProperty, DatabaseRow } from "@organize/shared";

/** 度量函数 */
export type AggregationFn = "count" | "sum" | "avg";

/** 单个聚合结果（一个分组 → 一个数值） */
export interface AggregationResult {
  /** 分组键（option id / "true" / "false" / 文本值 / UNGROUPED_KEY） */
  key: string;
  /** 分组显示名 */
  label: string;
  /** 分组颜色（来自 select option.color，供图表着色） */
  color?: string;
  /** 聚合后的数值 */
  value: number;
}

export interface AggregateOptions {
  /** 分组依据的属性 id */
  groupByPropId: string;
  /** 度量方式 */
  metric: AggregationFn;
  /** sum / avg 时聚合的数值属性 id（count 时忽略） */
  valuePropId?: string;
}

export const UNGROUPED_KEY = "__ungrouped__";
export const UNGROUPED_LABEL = "未分组";

/**
 * 把一行数据映射到它所属的分组键集合（一行可能属于多个分组：multi_select）。
 * 返回 [{ key, label, color? }]，无分组时返回 [{ key: UNGROUPED_KEY, ... }]。
 */
function rowGroupKeys(
  row: DatabaseRow,
  prop: DatabaseProperty | undefined
): { key: string; label: string; color?: string }[] {
  if (!prop) {
    return [{ key: UNGROUPED_KEY, label: UNGROUPED_LABEL }];
  }

  const val = ((row.values || {}) as Record<string, unknown>)[prop.id];
  const options = prop.options || [];
  const optById = new Map(options.map((o) => [o.id, o]));

  switch (prop.type) {
    case "select": {
      if (val === null || val === undefined || val === "") {
        return [{ key: UNGROUPED_KEY, label: UNGROUPED_LABEL }];
      }
      const id = String(val);
      const opt = optById.get(id);
      if (opt) {
        return [{ key: opt.id, label: opt.name, color: opt.color }];
      }
      // 选项已删除 → ungrouped
      return [{ key: UNGROUPED_KEY, label: UNGROUPED_LABEL }];
    }
    case "multi_select": {
      const ids = Array.isArray(val) ? (val as string[]) : [];
      if (ids.length === 0) {
        return [{ key: UNGROUPED_KEY, label: UNGROUPED_LABEL }];
      }
      const out: { key: string; label: string; color?: string }[] = [];
      for (const id of ids) {
        const opt = optById.get(String(id));
        if (opt) {
          out.push({ key: opt.id, label: opt.name, color: opt.color });
        }
      }
      // 至少一个有效选项 → 进入这些组；全部选项已删除 → ungrouped
      return out.length > 0 ? out : [{ key: UNGROUPED_KEY, label: UNGROUPED_LABEL }];
    }
    case "checkbox": {
      // true / false 两组
      const b = val === true;
      return [{ key: b ? "true" : "false", label: b ? "已勾选" : "未勾选" }];
    }
    case "text":
    default: {
      // 文本 / 其它：按字面值分组，空值 → ungrouped
      if (val === null || val === undefined || val === "") {
        return [{ key: UNGROUPED_KEY, label: UNGROUPED_LABEL }];
      }
      const s = String(val);
      // 文本分组用值本身做 key 与 label（不预定义选项）
      return [{ key: s, label: s }];
    }
  }
}

/** 取一行的数值属性值（非数值 / 缺失返回 null） */
function numericValue(row: DatabaseRow, propId: string): number | null {
  const v = ((row.values || {}) as Record<string, unknown>)[propId];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * 聚合主函数
 * @param rows 行数组（建议先经过筛选/排序，聚合结果会尊重当前过滤）
 * @param opts 聚合选项
 * @param schema 数据库 schema
 * @returns 按 value 倒序稳定排列的聚合结果
 */
export function aggregate(
  rows: DatabaseRow[],
  opts: AggregateOptions,
  schema: DatabaseProperty[]
): AggregationResult[] {
  const groupProp = schema.find((p) => p.id === opts.groupByPropId);

  // 为每个分组累积「行数」与「数值和」
  const stats = new Map<
    string,
    { label: string; color?: string; count: number; numCount: number; sum: number }
  >();

  const getStat = (key: string, label: string, color?: string) => {
    let s = stats.get(key);
    if (!s) {
      s = { label, color, count: 0, numCount: 0, sum: 0 };
      stats.set(key, s);
    }
    return s;
  };

  for (const row of rows) {
    const keys = rowGroupKeys(row, groupProp);
    for (const k of keys) {
      const s = getStat(k.key, k.label, k.color);
      s.count += 1;
      if (opts.metric !== "count" && opts.valuePropId) {
        const n = numericValue(row, opts.valuePropId);
        if (n !== null) {
          s.numCount += 1;
          s.sum += n;
        }
      }
    }
  }

  const results: AggregationResult[] = [];
  for (const [key, s] of Array.from(stats.entries())) {
    let value: number;
    if (opts.metric === "count") {
      value = s.count;
    } else if (opts.metric === "sum") {
      value = s.sum;
    } else {
      // avg：分母 = 该组有数值的行数；全无非数值时为 0
      value = s.numCount > 0 ? s.sum / s.numCount : 0;
    }
    results.push({ key, label: s.label, color: s.color, value });
  }

  // 按 value 倒序稳定排（相等时保持插入顺序）
  // 用 index 锁定稳定：先记下原始顺序
  const indexed = results.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    if (b.r.value !== a.r.value) return b.r.value - a.r.value;
    return a.i - b.i;
  });
  return indexed.map((x) => x.r);
}
