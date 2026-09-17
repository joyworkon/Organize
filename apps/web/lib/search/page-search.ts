/**
 * 页内搜索（功能页页头搜索框）的唯一匹配口径。
 *
 * 契约：
 * - 只在"当前功能"的数据里匹配，跨功能搜索走 ⌘K 命令面板
 * - 匹配面 = 标题 + 标签名（+ 各页额外传入的辅助字段，如摘要 / 站点 / 正文片段）
 * - 多个关键词按空白切分，AND 关系（每个词都要命中任一字段），大小写与全半角空白不敏感
 * - 空查询一律视为"不筛选"，由调用方直接返回原列表
 */

export function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 把查询串切成关键词；空串返回空数组（= 不筛选） */
export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
}

export interface PageSearchTarget {
  /** 标题（必选匹配面） */
  title?: string | null;
  /** 标签名列表（必选匹配面）；也接受 {name} 对象数组 */
  tags?: Array<string | { name?: string | null } | null | undefined> | null;
  /** 附加匹配面：摘要 / 站点 / 正文纯文本 / 清单名等，由各页自行决定 */
  extra?: Array<string | null | undefined>;
}

/** 单条数据是否命中查询；空查询恒为 true */
export function matchesPageSearch(query: string, target: PageSearchTarget): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const haystack: string[] = [];
  if (target.title) haystack.push(target.title);
  for (const tag of target.tags || []) {
    if (!tag) continue;
    if (typeof tag === "string") haystack.push(tag);
    else if (tag.name) haystack.push(tag.name);
  }
  for (const value of target.extra || []) {
    if (value) haystack.push(value);
  }
  const normalized = haystack.map((value) => normalizeSearchText(value)).filter(Boolean);
  return tokens.every((token) => normalized.some((field) => field.includes(token)));
}

/** 列表过滤糖：空查询直接返回原数组引用 */
export function filterByPageSearch<T>(
  items: T[],
  query: string,
  pick: (item: T) => PageSearchTarget
): T[] {
  if (searchTokens(query).length === 0) return items;
  return items.filter((item) => matchesPageSearch(query, pick(item)));
}
