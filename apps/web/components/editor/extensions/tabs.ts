/** Tabs 块的纯逻辑：activeIndex 归一化与 tab 结构规范化。 */

export const MIN_TAB_COUNT = 1;
export const MAX_TAB_COUNT = 12;
export const DEFAULT_TAB_TITLE = "无标题";

/** 把 activeIndex 钳制到合法范围（与子 tab 数量对齐）。 */
export function normalizeActiveIndex(value: unknown, tabCount: number): number {
  const count = Math.max(MIN_TAB_COUNT, Math.min(MAX_TAB_COUNT, Math.floor(tabCount)));
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 0;
  return Math.max(0, Math.min(count - 1, parsed));
}

/** 校验 tab 标题，空值回退默认。 */
export function normalizeTabTitle(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || DEFAULT_TAB_TITLE;
}
