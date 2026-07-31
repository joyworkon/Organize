/**
 * 数据库视图共享类型：筛选条件、排序规则
 * 这些类型存储在 DatabaseView.config.filters / config.sorts 中
 */

// ---- 筛选 ----

export type FilterOperator =
  // 通用
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  // 文本 / URL
  | "contains"
  | "does_not_contain"
  | "starts_with"
  | "ends_with"
  // 数字
  | "equals"
  | "not_equals"
  | "greater_than"
  | "less_than"
  | "greater_equal"
  | "less_equal"
  // 复选框
  | "checked"
  | "unchecked"
  // 多选
  | "includes"
  | "not_includes";

export interface DatabaseFilter {
  id: string;
  propertyId: string;
  operator: FilterOperator;
  /** 比较值（is_empty/is_not_empty/checked/unchecked 无需 value） */
  value?: unknown;
}

export type FilterConjunction = "and" | "or";

// ---- 排序 ----

export interface DatabaseSort {
  id: string;
  propertyId: string;
  direction: "asc" | "desc";
}
