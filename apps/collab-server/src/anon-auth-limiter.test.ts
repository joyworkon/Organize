import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnonAuthLimiter,
  ANON_AUTH_LIMIT_PER_KEY,
  ANON_AUTH_LIMIT_PER_TOKEN,
  parseBackend,
  resetAnonAuthMemoryForTest,
  type SharedConsume,
} from "./anon-auth-limiter";

// A06：多实例合计语义在这里以「两个 limiter 实例共享同一 sharedConsume 状态」
// 验证（真实共享 = 076 RPC 的 Postgres 行，由 pgTAP 076 与
// scripts/verify-shared-rate-limit.mjs 两实例实测覆盖）。

describe("parseBackend", () => {
  it("defaults to memory; only postgres is recognized", () => {
    expect(parseBackend(undefined)).toBe("memory");
    expect(parseBackend("memory")).toBe("memory");
    expect(parseBackend("postgres")).toBe("postgres");
    expect(parseBackend("redis")).toBe("memory");
  });
});

describe("AnonAuthLimiter (memory backend)", () => {
  beforeEach(() => resetAnonAuthMemoryForTest());
  afterEach(() => resetAnonAuthMemoryForTest());

  it("token+IP 档 30/min：第 31 次拒绝", async () => {
    const limiter = new AnonAuthLimiter({ backend: "memory" });
    for (let i = 0; i < ANON_AUTH_LIMIT_PER_KEY; i++) {
      expect(await limiter.allowed("tok-m1", "1.2.3.4")).toBe(true);
    }
    expect(await limiter.allowed("tok-m1", "1.2.3.4")).toBe(false);
  });

  it("不同 IP 各自独立计数（一人被限不耗尽整条链接）", async () => {
    const limiter = new AnonAuthLimiter({ backend: "memory" });
    for (let i = 0; i < ANON_AUTH_LIMIT_PER_KEY; i++) {
      expect(await limiter.allowed("tok-m2", "1.1.1.1")).toBe(true);
    }
    expect(await limiter.allowed("tok-m2", "1.1.1.1")).toBe(false);
    expect(await limiter.allowed("tok-m2", "2.2.2.2")).toBe(true);
  });

  it("单 token 总量档 120/min：轮换 IP 也被兜住（不信任 XFF）", async () => {
    const limiter = new AnonAuthLimiter({ backend: "memory" });
    for (let i = 0; i < ANON_AUTH_LIMIT_PER_TOKEN; i++) {
      expect(await limiter.allowed("tok-m3", `10.0.${i >> 8}.${i % 256}`)).toBe(true);
    }
    // 每 IP 只打了 1 次，IP 档远未到；总量档 120 已满
    expect(await limiter.allowed("tok-m3", "10.9.9.9")).toBe(false);
  });

  it("无 IP（无可信边缘代理）：只走单 token 总量档", async () => {
    const limiter = new AnonAuthLimiter({ backend: "memory" });
    for (let i = 0; i < ANON_AUTH_LIMIT_PER_TOKEN; i++) {
      expect(await limiter.allowed("tok-m4", null)).toBe(true);
    }
    expect(await limiter.allowed("tok-m4", null)).toBe(false);
  });
});

describe("AnonAuthLimiter (postgres backend)", () => {
  beforeEach(() => resetAnonAuthMemoryForTest());
  afterEach(() => resetAnonAuthMemoryForTest());

  /** 假共享存储：Map 计数模拟 076 的全局行（跨 limiter 实例共享） */
  function fakeSharedStore() {
    const hits = new Map<string, number>();
    const consume: SharedConsume = async (key, limit) => {
      const n = (hits.get(key) ?? 0) + 1;
      hits.set(key, n);
      return n <= limit;
    };
    return { hits, consume };
  }

  it("两个实例共享计数：合计 30 次后拒绝（A06 核心语义）", async () => {
    const { consume } = fakeSharedStore();
    const a = new AnonAuthLimiter({ backend: "postgres", sharedConsume: consume });
    const b = new AnonAuthLimiter({ backend: "postgres", sharedConsume: consume });
    for (let i = 0; i < ANON_AUTH_LIMIT_PER_KEY; i++) {
      // 交替调用：实例 A 与 B 对同一 key 的计数必须累计
      const limiter = i % 2 === 0 ? a : b;
      expect(await limiter.allowed("tok-p1", "1.2.3.4")).toBe(true);
    }
    expect(await a.allowed("tok-p1", "1.2.3.4")).toBe(false);
    expect(await b.allowed("tok-p1", "1.2.3.4")).toBe(false);
  });

  it("轮换 IP 绕不过共享总量档（120/min 全实例合计）", async () => {
    const { consume } = fakeSharedStore();
    const a = new AnonAuthLimiter({ backend: "postgres", sharedConsume: consume });
    const b = new AnonAuthLimiter({ backend: "postgres", sharedConsume: consume });
    for (let i = 0; i < ANON_AUTH_LIMIT_PER_TOKEN; i++) {
      const limiter = i % 2 === 0 ? a : b;
      expect(await limiter.allowed("tok-p2", `10.0.${i >> 8}.${i % 256}`)).toBe(true);
    }
    expect(await a.allowed("tok-p2", "10.8.8.8")).toBe(false);
  });

  it("共享通道失败：本次回退进程内档并 warn（日志不打 token）", async () => {
    const onFallback = vi.fn();
    const failing: SharedConsume = async () => {
      throw new Error("fetch failed");
    };
    const limiter = new AnonAuthLimiter({
      backend: "postgres",
      sharedConsume: failing,
      onFallback,
    });
    // 回退后进程内计数生效
    for (let i = 0; i < ANON_AUTH_LIMIT_PER_KEY; i++) {
      expect(await limiter.allowed("tok-p3", "1.2.3.4")).toBe(true);
    }
    expect(await limiter.allowed("tok-p3", "1.2.3.4")).toBe(false);
    expect(onFallback).toHaveBeenCalled();
    for (const call of onFallback.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("tok-p3");
    }
  });

  it("共享通道恢复后回到共享计数（故障窗口只弱化不偏移）", async () => {
    let broken = true;
    const { consume } = fakeSharedStore();
    const limiter = new AnonAuthLimiter({
      backend: "postgres",
      sharedConsume: async (key, limit, windowMs) => {
        if (broken) throw new Error("down");
        return consume(key, limit, windowMs);
      },
      onFallback: () => {},
    });
    expect(await limiter.allowed("tok-p4", "1.2.3.4")).toBe(true); // 回退进程内
    broken = false;
    // 共享计数从 0 开始（进程内那次没有写进共享存储）
    expect(await limiter.allowed("tok-p4", "1.2.3.4")).toBe(true);
  });

  it("postgres backend 但未注入 sharedConsume：等价 memory", async () => {
    const limiter = new AnonAuthLimiter({ backend: "postgres" });
    for (let i = 0; i < ANON_AUTH_LIMIT_PER_KEY; i++) {
      expect(await limiter.allowed("tok-p5", "1.2.3.4")).toBe(true);
    }
    expect(await limiter.allowed("tok-p5", "1.2.3.4")).toBe(false);
  });
});
