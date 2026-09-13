import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  rateLimit,
  resetSharedClientForTest,
  resolveBackend,
} from "./rate-limit";

// A06：checkRateLimit 的 postgres 分支经模块级 anon client 调 076 RPC。
// mock 掉 supabase-js 以注入可控 rpc 实现；真实语义由 pgTAP 076 + 两实例
// 实测脚本（scripts/verify-shared-rate-limit.mjs）覆盖。
const rpcMock = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

const ENV_KEYS = ["RATE_LIMIT_BACKEND", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
let savedEnv: Record<string, string | undefined>;

describe("rateLimit (save/invite 路由限流纯函数)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit within the window, then blocks", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("k1", 5, 60_000)).toBe(true);
    }
    expect(rateLimit("k1", 5, 60_000)).toBe(false);
    expect(rateLimit("k1", 5, 60_000)).toBe(false);
  });

  it("keys are isolated", () => {
    for (let i = 0; i < 5; i++) {
      expect(rateLimit("k2", 5, 60_000)).toBe(true);
    }
    expect(rateLimit("k3", 5, 60_000)).toBe(true);
  });

  it("frees slots once the window slides past", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k4", 3, 60_000)).toBe(true);
    }
    expect(rateLimit("k4", 3, 60_000)).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit("k4", 3, 60_000)).toBe(true);
  });
});

describe("resolveBackend", () => {
  it("defaults to memory and only recognizes postgres explicitly", () => {
    expect(resolveBackend(undefined)).toBe("memory");
    expect(resolveBackend("memory")).toBe("memory");
    expect(resolveBackend("postgres")).toBe("postgres");
    // 未知值 fail-safe 回 memory（拼错不静默换通道）
    expect(resolveBackend("redis")).toBe("memory");
  });
});

describe("checkRateLimit (A06 双 backend)", () => {
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    rpcMock.mockReset();
    resetSharedClientForTest();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetSharedClientForTest();
    vi.restoreAllMocks();
  });

  it("memory backend: 不碰 RPC，进程内滑动窗口生效", async () => {
    delete process.env.RATE_LIMIT_BACKEND;
    for (let i = 0; i < 2; i++) {
      expect(await checkRateLimit("c-1", 2, 60_000)).toBe(true);
    }
    expect(await checkRateLimit("c-1", 2, 60_000)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("postgres backend: 透传 RPC 判定并传对参数", async () => {
    process.env.RATE_LIMIT_BACKEND = "postgres";
    rpcMock.mockResolvedValue({ data: true, error: null });
    expect(await checkRateLimit("public-save:tok:1.2.3.4", 30, 60_000)).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("consume_rate_limit", {
      p_key: "public-save:tok:1.2.3.4",
      p_limit: 30,
      p_window_ms: 60_000,
    });

    rpcMock.mockResolvedValue({ data: false, error: null });
    expect(await checkRateLimit("public-save:tok:1.2.3.4", 30, 60_000)).toBe(false);
  });

  it("postgres backend: RPC 失败不重试，回退进程内档（故障窗口弱化为单实例）", async () => {
    process.env.RATE_LIMIT_BACKEND = "postgres";
    rpcMock.mockRejectedValue(new Error("fetch failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 回退后进程内仍计数：3 次内放行
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit("c-fallback", 3, 60_000)).toBe(true);
    }
    expect(await checkRateLimit("c-fallback", 3, 60_000)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(4);
    // 日志不含 key（内嵌分享 token）
    for (const [firstArg] of warn.mock.calls) {
      expect(String(firstArg)).not.toContain("c-fallback");
    }
  });

  it("postgres backend: error 响应同样回退进程内档", async () => {
    process.env.RATE_LIMIT_BACKEND = "postgres";
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await checkRateLimit("c-err", 1, 60_000)).toBe(true);
    expect(await checkRateLimit("c-err", 1, 60_000)).toBe(false);
  });

  it("postgres backend 但缺 Supabase env：client 起不来，回退进程内档", async () => {
    process.env.RATE_LIMIT_BACKEND = "postgres";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await checkRateLimit("c-noenv", 1, 60_000)).toBe(true);
    expect(await checkRateLimit("c-noenv", 1, 60_000)).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
