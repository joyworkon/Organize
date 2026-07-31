/**
 * 筛选求值器 —— 纯函数，对 db_rows 的 values 做条件过滤
 * 必须单测覆盖（见 filters.test.ts）
 */
import type { DatabaseProperty, DatabaseRow } from "@organize/shared";
import type { DatabaseFilter, FilterConjunction } from "./types";

/** 判断单个值是否为"空" */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/** 将值转为可比较的字符串（小写） */
function toStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase();
}

/** 将值转为数字 */
function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 对单行的单个属性值执行筛选条件判断
 */
export function evaluateFilter(
  value: unknown,
  filter: DatabaseFilter,
  prop: DatabaseProperty | undefined
): boolean {
  const { operator } = filter;
  const filterValue = filter.value;

  switch (operator) {
    // ---- 通用 ----
    case "is_empty":
      return isEmpty(value);
    case "is_not_empty":
      return !isEmpty(value);

    case "is": {
      if (prop?.type === "checkbox") return Boolean(value) === Boolean(filterValue);
      if (isEmpty(value) && isEmpty(filterValue)) return true;
      return toStr(value) === toStr(filterValue);
    }
    case "is_not": {
      if (prop?.type === "checkbox") return Boolean(value) !== Boolean(filterValue);
      if (isEmpty(value) && isEmpty(filterValue)) return false;
      return toStr(value) !== toStr(filterValue);
    }

    // ---- 文本 / URL ----
    case "contains":
      return toStr(value).includes(toStr(filterValue));
    case "does_not_contain":
      return !toStr(value).includes(toStr(filterValue));
    case "starts_with":
      return toStr(value).startsWith(toStr(filterValue));
    case "ends_with":
      return toStr(value).endsWith(toStr(filterValue));

    // ---- 数字 ----
    case "equals": {
      const a = toNum(value);
      const b = toNum(filterValue);
      if (a === null && b === null) return true;
      if (a === null || b === null) return false;
      return a === b;
    }
    case "not_equals": {
      const a = toNum(value);
      const b = toNum(filterValue);
      if (a === null && b === null) return false;
      if (a === null || b === null) return true;
      return a !== b;
    }
    case "greater_than": {
      const a = toNum(value);
      const b = toNum(filterValue);
      if (a === null || b === null) return false;
      return a > b;
    }
    case "less_than": {
      const a = toNum(value);
      const b = toNum(filterValue);
      if (a === null || b === null) return false;
      return a < b;
    }
    case "greater_equal": {
      const a = toNum(value);
      const b = toNum(filterValue);
      if (a === null || b === null) return false;
      return a >= b;
    }
    case "less_equal": {
      const a = toNum(value);
      const b = toNum(filterValue);
      if (a === null || b === null) return false;
      return a <= b;
    }

    // ---- 复选框 ----
    case "checked":
      return Boolean(value) === true;
    case "unchecked":
      return !value;

    // ---- 多选 ----
    case "includes": {
      const arr = Array.isArray(value) ? (value as unknown[]) : [];
      return arr.some((v) => toStr(v) === toStr(filterValue));
    }
    case "not_includes": {
      const arr = Array.isArray(value) ? (value as unknown[]) : [];
      return !arr.some((v) => toStr(v) === toStr(filterValue));
    }

    default:
      return true;
  }
}

/**
 * 对行数组应用筛选条件列表
 * @param rows 所有行
 * @param filters 筛选条件数组
 * @param schema 数据库 schema（用于查找属性类型）
 * @param conjunction 条件间逻辑（默认 "and"）
 */
export function applyFilters(
  rows: DatabaseRow[],
  filters: DatabaseFilter[],
  schema: DatabaseProperty[],
  conjunction: FilterConjunction = "and"
): DatabaseRow[] {
  if (!filters.length) return rows;

  const propMap = new Map(schema.map((p) => [p.id, p]));

  return rows.filter((row) => {
    const values = (row.values || {}) as Record<string, unknown>;
    const results = filters.map((f) => {
      const prop = propMap.get(f.propertyId);
      const value = values[f.propertyId];
      return evaluateFilter(value, f, prop);
    });
    return conjunction === "and"
      ? results.every(Boolean)
      : results.some(Boolean);
  });
}
