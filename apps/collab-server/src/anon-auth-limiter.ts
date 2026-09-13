// 匿名握手限流（072 §6 非协商项；A06 扩展为双 backend，
// 设计 docs/anon-rate-limit-design.md）。
//
// 两级键（语义不变，单实例/多实例通用）：
//   token+IP 每档 30/min —— 单攻击者封不住整条链接（正常协作不被一人耗尽）
//   单 token 总量 120/min —— XFF 可伪造，IP 档只是细分，总量档才是硬闸
//
// backend：
//   memory（默认）—— 进程内滑动窗口，单实例语义（BLOCKED.md Track A/B 声明 3 边界）
//   postgres —— 调 076 的 consume_rate_limit RPC，多实例对同一 key 全局合计；
//     RPC 失败（throw）不重试（限流非正确性关键路径），该次判定整体回退
//     进程内档并 warn（日志不打 key——key 内嵌分享 token）。故障窗口内
//     弱化为单实例，共享存储恢复后自动回到共享计数。
//
// 窗口时钟：postgres 档取 DB clock_timestamp()（实例时钟漂移不撕开窗口），
// memory 档取本进程时钟。

export type AnonAuthBackend = "memory" | "postgres";

/** 与 web 端 /api/public-share/[token]/save 同名同值，保持两端一致 */
export const ANON_AUTH_LIMIT_PER_KEY = 30;
export const ANON_AUTH_LIMIT_PER_TOKEN = 120;
export const ANON_AUTH_WINDOW_MS = 60_000;

export function parseBackend(raw: string | undefined): AnonAuthBackend {
  return raw === "postgres" ? "postgres" : "memory";
}

/** 调 076 consume_rate_limit；判定为 boolean，调用失败 throw（由 limiter 回退） */
export type SharedConsume = (
  key: string,
  limit: number,
  windowMs: number
) => Promise<boolean>;

export interface AnonAuthLimiterOptions {
  backend: AnonAuthBackend;
  sharedConsume?: SharedConsume;
  /** 测试注入：失败回退时的日志出口（生产走 console.warn） */
  onFallback?: (err: unknown) => void;
}

const memoryHits = new Map<string, number[]>();

function memoryAllowed(key: string, limit: number): boolean {
  const now = Date.now();
  const hits = (memoryHits.get(key) ?? []).filter(
    (t) => now - t < ANON_AUTH_WINDOW_MS
  );
  if (hits.length >= limit) {
    memoryHits.set(key, hits);
    return false;
  }
  hits.push(now);
  memoryHits.set(key, hits);
  if (memoryHits.size > 10000) {
    for (const [k, v] of memoryHits) {
      if (v.every((t) => now - t >= ANON_AUTH_WINDOW_MS)) memoryHits.delete(k);
    }
  }
  return true;
}

/** 测试用：清进程内计数 */
export function resetAnonAuthMemoryForTest(): void {
  memoryHits.clear();
}

export class AnonAuthLimiter {
  readonly #backend: AnonAuthBackend;
  readonly #sharedConsume?: SharedConsume;
  readonly #onFallback: (err: unknown) => void;

  constructor(opts: AnonAuthLimiterOptions) {
    this.#backend = opts.backend;
    this.#sharedConsume = opts.sharedConsume;
    this.#onFallback =
      opts.onFallback ??
      ((err) =>
        console.warn(
          "[rate-limit] shared backend failed, falling back to in-process:",
          err instanceof Error ? err.message : err
        ));
  }

  /**
   * 单档判定。null = 共享通道未启用或本次失败（失败已 warn），调用方回退进程内。
   */
  async #consume(key: string, limit: number): Promise<boolean | null> {
    if (this.#backend !== "postgres" || !this.#sharedConsume) return null;
    try {
      return await this.#sharedConsume(key, limit, ANON_AUTH_WINDOW_MS);
    } catch (err) {
      this.#onFallback(err);
      return null;
    }
  }

  async allowed(shareToken: string, ip: string | null): Promise<boolean> {
    const perToken = await this.#consume(
      `anon-auth:t:${shareToken}`,
      ANON_AUTH_LIMIT_PER_TOKEN
    );
    if (perToken === null) {
      // 共享通道不可用：本次整体回退进程内（两档都走内存，口径一致）
      return this.#memoryAllowedBoth(shareToken, ip);
    }
    if (!perToken) return false;
    if (!ip) return true;
    const perKey = await this.#consume(
      `anon-auth:ti:${shareToken}:${ip}`,
      ANON_AUTH_LIMIT_PER_KEY
    );
    if (perKey === null) return this.#memoryAllowedBoth(shareToken, ip);
    return perKey;
  }

  #memoryAllowedBoth(shareToken: string, ip: string | null): boolean {
    if (!memoryAllowed(`anon-auth:t:${shareToken}`, ANON_AUTH_LIMIT_PER_TOKEN)) {
      return false;
    }
    if (!ip) return true;
    return memoryAllowed(
      `anon-auth:ti:${shareToken}:${ip}`,
      ANON_AUTH_LIMIT_PER_KEY
    );
  }
}
