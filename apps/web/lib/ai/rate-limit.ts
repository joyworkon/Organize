/**
 * AI 路由限流：按「用户 + 功能」的固定窗口计数器。
 *
 * 服务端内存实现（与 /api/scrape 的内存缓存同模式）：单实例有效、重启清零。
 * 目标是防误用与脚本刷接口烧 API 配额，不是严格的配额管理——
 * 多实例部署时应升级为共享存储（如 Redis），当前单实例部署下够用。
 */

export interface RateLimitRule {
  /** 窗口内允许的最大请求数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 窗口内剩余可用次数 */
  remaining: number;
  /** 窗口重置时刻（Unix 毫秒） */
  resetAt: number;
}

/** 各 AI 功能的限流预算（每用户独立计算） */
export const AI_RATE_LIMITS = {
  /** 问 AI：纯文本，成本较低 */
  ask: { limit: 20, windowMs: 60_000 },
  /** AI 速记：录音转写 + 摘要两段调用，成本最高 */
  notes: { limit: 5, windowMs: 60_000 },
  /** 标签推荐：短文本单次调用 */
  tags: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** 桶数量上限：超限时先清理过期桶，防长期运行内存缓慢增长 */
const MAX_BUCKETS = 10_000;

/**
 * 检查一次请求是否放行。
 * 被拒绝的请求同样计数（窗口内持续超限则持续拒绝，直到窗口重置）。
 */
export function checkRateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_BUCKETS) {
    buckets.forEach((bucket, bucketKey) => {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    });
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + rule.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: rule.limit - 1, resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= rule.limit,
    remaining: Math.max(0, rule.limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** 测试用：清空所有限流桶 */
export function resetRateLimits(): void {
  buckets.clear();
}
