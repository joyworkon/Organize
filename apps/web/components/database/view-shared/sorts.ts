/**
 * 排序求值器 —— 纯函数，对 db_rows 按属性值排序
 * 必须单测覆盖（见 sorts.test.ts）
 */
import type { DatabaseProperty, DatabaseRow } from "@organize/shared";
import type { DatabaseSort } from "./types";

/** 获取值的排序权重（null/空 永远排最后） */
function compareValues(
  a: unknown,
  b: unknown,
  propType: string | undefined
): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";

  // 空值排最后
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  // 数字类型：数值比较
  if (propType === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }

  // 复选框：false < true
  if (propType === "checkbox") {
    return Number(Boolean(a)) - Number(Boolean(b));
  }

  // 日期：ISO 字符串可直接 localeCompare
  if (propType === "date") {
    return String(a).localeCompare(String(b));
  }

  // 多选：比较第一个选项（或选项数量）
  if (propType === "multi_select") {
    const arrA = Array.isArray(a) ? (a as unknown[]) : [];
    const arrB = Array.isArray(b) ? (b as unknown[]) : [];
    const firstA = arrA.length ? String(arrA[0]) : "";
    const firstB = arrB.length ? String(arrB[0]) : "";
    return firstA.localeCompare(firstB, "zh-CN");
  }

  // 默认：字符串比较（中文友好）
  return String(a).localeCompare(String(b), "zh-CN");
}

/**
 * 对行数组应用排序规则列表（稳定排序）
 * @param rows 行数组（不会被修改，返回新数组）
 * @param sorts 排序规则数组（优先级从前到后）
 * @param schema 数据库 schema
 */
export function applySorts(
  rows: DatabaseRow[],
  sorts: DatabaseSort[],
  schema: DatabaseProperty[]
): DatabaseRow[] {
  if (!sorts.length) return rows;

  const propMap = new Map(schema.map((p) => [p.id, p]));
  const sorted = [...rows];

  sorted.sort((rowA, rowB) => {
    const valuesA = (rowA.values || {}) as Record<string, unknown>;
    const valuesB = (rowB.values || {}) as Record<string, unknown>;

    for (const sort of sorts) {
      const prop = propMap.get(sort.propertyId);
      const a = valuesA[sort.propertyId];
      const b = valuesB[sort.propertyId];

      // 空值永远排最后，不受 direction 影响
      const aEmpty = a === null || a === undefined || a === "";
      const bEmpty = b === null || b === undefined || b === "";
      if (aEmpty && bEmpty) continue;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      let cmp = compareValues(a, b, prop?.type);
      if (sort.direction === "desc") cmp = -cmp;
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  return sorted;
}
