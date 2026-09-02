/**
 * 进程内滑动窗口限流：同一 key 在 windowMs 内最多 limit 次，超出返回 false。
 * key 建议带维度前缀，如 `invite:${userId}`、`public-save:${token}:${ip}`。
 *
 * 已知限制（登记用）：单实例内存桶，多实例 / 重启即失效。对「防刷邮件、
 * 防匿名写穿透」的第一道闸够用；跨实例精确限流需外置存储，暂不引入。
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 10000;

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);

  // 粗粒度防泄漏：key 总量超阈值时清一遍已滑出窗口的桶
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return true;
}
