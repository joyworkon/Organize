/**
 * 限流模块（A06 扩展为双 backend）：
 *
 * - `rateLimit()`：进程内滑动窗口（原实现，单实例默认）。
 * - `checkRateLimit()`：按 `RATE_LIMIT_BACKEND` 选择 backend——
 *   `memory`（默认，零外部依赖）走 rateLimit；`postgres`（多实例部署时开启）
 *   调 076 的 consume_rate_limit RPC，全实例对同一 key 全局合计。
 *
 * postgres backend 的故障策略（docs/anon-rate-limit-design.md §4）：
 * RPC 失败不重试（限流不是正确性关键路径——授权在保存/回放 RPC 实时判），
 * 回退进程内档并 warn 一次（日志不含 key——key 内嵌分享 token）。
 * 故障窗口内限流弱化为单实例语义。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export type RateLimitBackend = "memory" | "postgres";

export function resolveBackend(raw: string | undefined): RateLimitBackend {
  return raw === "postgres" ? "postgres" : "memory";
}

// 模块级单例：限流 RPC 是 anon 可调的 SECURITY DEFINER，不依赖请求上下文
// （匿名保存路由本就无用户会话）。构建失败（缺 env 等）时保持 null → 走 fallback。
let sharedClient: SupabaseClient | null = null;
let sharedClientInitFailed = false;

function getSharedClient(): SupabaseClient | null {
  if (sharedClient || sharedClientInitFailed) return sharedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    sharedClientInitFailed = true;
    return null;
  }
  try {
    sharedClient = createClient(url, key, { auth: { persistSession: false } });
  } catch {
    sharedClientInitFailed = true;
  }
  return sharedClient;
}

/** 测试用：重置模块级单例 */
export function resetSharedClientForTest(): void {
  sharedClient = null;
  sharedClientInitFailed = false;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  if (resolveBackend(process.env.RATE_LIMIT_BACKEND) !== "postgres") {
    return rateLimit(key, limit, windowMs);
  }

  const client = getSharedClient();
  if (!client) {
    // 配了 postgres 但 client 起不来（缺 env 等）：回退进程内档
    return rateLimit(key, limit, windowMs);
  }

  try {
    const { data, error } = await client.rpc("consume_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (err) {
    // 不打 key（内嵌分享 token）；error.message 来自 Supabase/Postgres，不含 key
    console.warn(
      "[rate-limit] shared backend failed, falling back to in-process:",
      err instanceof Error ? err.message : err
    );
    return rateLimit(key, limit, windowMs);
  }
}
