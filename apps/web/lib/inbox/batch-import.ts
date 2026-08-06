/**
 * 批量导入的纯工具函数：URL 解析、去重、并发控制。
 * 不含任何 React / DOM 依赖，方便单测。
 */

export type BatchItemStatus = "pending" | "scraping" | "saving" | "done" | "failed";

export interface BatchItem {
  /** 客户端生成的临时 id（用 url 当 id 也行，但去重后保证唯一） */
  id: string;
  url: string;
  status: BatchItemStatus;
  error?: string;
  /** 抓取得到的标题（用于展示） */
  title?: string;
}

const EXPLICIT_HTTP_URL = /https?:\/\/[^\s<>"'，。；！？、）】》]+/gi;
const TRAILING_URL_PUNCTUATION = /[\])}>.,;!?，。；！？、）】》]+$/;

/** 从链接或平台分享文案中提取第一个 URL。 */
export function extractFirstUrl(raw: string): string | null {
  return parseBatchUrls(raw)[0] || null;
}

/**
 * 把用户粘贴的文本拆成 URL 列表。
 * - 支持换行 / 逗号 / 空格 / 制表符分隔
 * - 自动 trim，去掉行首项目符号（- * • 等）
 * - 过滤空串和非 http(s) 链接
 * - 去重（保留顺序）
 */
export function parseBatchUrls(raw: string): string[] {
  if (!raw) return [];
  const tokens = raw
    .split(/[\n\r,\t\s]+/)
    .map((s) => s.trim())
    .map((s) => s.replace(/^[-*•·]+\s*/, "")) // 去掉行首项目符号
    .filter(Boolean);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tokens) {
    const explicitUrls = t.match(EXPLICIT_HTTP_URL);
    const candidates = explicitUrls?.length ? explicitUrls : [t];

    for (const candidate of candidates) {
      const cleaned = candidate.replace(TRAILING_URL_PUNCTUATION, "");
      const hasProtocol = /^https?:\/\//i.test(cleaned);
      if (!hasProtocol && !cleaned.includes(".")) continue;
      const normalized = hasProtocol ? cleaned : `https://${cleaned}`;

      try {
        const parsed = new URL(normalized);
        if (
          !["http:", "https:"].includes(parsed.protocol) ||
          !parsed.hostname.includes(".")
        ) {
          continue;
        }
      } catch {
        continue;
      }

      if (seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * 简单的并发信号量：限制同时运行的 Promise 数量。
 * 用法：
 *   const gate = createConcurrencyGate(3);
 *   await Promise.all(urls.map(u => gate(() => fetch(u))));
 */
export function createConcurrencyGate(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return async function gate<T>(task: () => Promise<T>): Promise<T> {
    // 占坑：若已达上限，等到有人释放
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}
