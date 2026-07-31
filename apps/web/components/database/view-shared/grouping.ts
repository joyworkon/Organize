/**
 * 分组工具 —— 看板视图按 select 属性分组
 */
import type { DatabaseProperty, DatabaseRow } from "@organize/shared";

export interface GroupedRows {
  /** 分组键（option id 或 "__ungrouped__"） */
  key: string;
  /** 分组显示名 */
  label: string;
  /** 分组颜色（来自 option.color） */
  color?: string;
  /** 该分组下的行 */
  rows: DatabaseRow[];
}

export const UNGROUPED_KEY = "__ungrouped__";

/**
 * 按 select 属性对行分组
 * @param rows 行数组
 * @param groupByPropId 用于分组的 select 属性 id
 * @param schema 数据库 schema
 */
export function groupBySelectProperty(
  rows: DatabaseRow[],
  groupByPropId: string,
  schema: DatabaseProperty[]
): GroupedRows[] {
  const prop = schema.find((p) => p.id === groupByPropId);
  if (!prop || (prop.type !== "select" && prop.type !== "multi_select")) {
    // 非 select 属性不支持分组，返回单个 ungrouped
    return [{ key: UNGROUPED_KEY, label: "全部", rows }];
  }

  const options = prop.options || [];
  const groups = new Map<string, DatabaseRow[]>();

  // 按选项顺序初始化分组
  for (const opt of options) {
    groups.set(opt.id, []);
  }
  groups.set(UNGROUPED_KEY, []);

  for (const row of rows) {
    const values = (row.values || {}) as Record<string, unknown>;
    const val = values[groupByPropId];

    if (prop.type === "multi_select") {
      // 多选：一行可出现在多个分组
      const ids = Array.isArray(val) ? (val as string[]) : [];
      if (ids.length === 0) {
        groups.get(UNGROUPED_KEY)!.push(row);
      } else {
        for (const id of ids) {
          if (groups.has(id)) {
            groups.get(id)!.push(row);
          } else {
            // 选项已被删除但值还在 → ungrouped
            groups.get(UNGROUPED_KEY)!.push(row);
          }
        }
      }
    } else {
      // 单选
      const id = val === null || val === undefined || val === "" ? null : String(val);
      if (id && groups.has(id)) {
        groups.get(id)!.push(row);
      } else {
        groups.get(UNGROUPED_KEY)!.push(row);
      }
    }
  }

  // 按选项顺序输出，ungrouped 放最后
  const result: GroupedRows[] = [];
  for (const opt of options) {
    const groupRows = groups.get(opt.id) || [];
    result.push({
      key: opt.id,
      label: opt.name,
      color: opt.color,
      rows: groupRows,
    });
  }
  const ungrouped = groups.get(UNGROUPED_KEY) || [];
  if (ungrouped.length > 0 || options.length === 0) {
    result.push({ key: UNGROUPED_KEY, label: "未分组", rows: ungrouped });
  }

  return result;
}
