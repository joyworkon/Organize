import { describe, expect, it, beforeEach } from "vitest";
import { AI_RATE_LIMITS, checkRateLimit, resetRateLimits } from "./rate-limit";

describe("AI rate limiter", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("窗口内未超限的请求全部放行", () => {
    const rule = { limit: 3, windowMs: 60_000 };
    expect(checkRateLimit("ask:u1", rule, 1000)).toEqual({
      allowed: true,
      remaining: 2,
      resetAt: 61_000,
    });
    expect(checkRateLimit("ask:u1", rule, 2000).allowed).toBe(true);
    expect(checkRateLimit("ask:u1", rule, 3000).allowed).toBe(true);
    expect(checkRateLimit("ask:u1", rule, 4000).remaining).toBe(0);
  });

  it("超过 limit 后拒绝，剩余次数不小于 0", () => {
    const rule = { limit: 2, windowMs: 60_000 };
    checkRateLimit("ask:u1", rule, 1000);
    checkRateLimit("ask:u1", rule, 2000);
    const blocked = checkRateLimit("ask:u1", rule, 3000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt).toBe(61_000);
  });

  it("窗口过期后重置计数", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    checkRateLimit("ask:u1", rule, 1000);
    expect(checkRateLimit("ask:u1", rule, 2000).allowed).toBe(false);
    // 越过窗口边界：新窗口、新计数
    const renewed = checkRateLimit("ask:u1", rule, 61_000);
    expect(renewed.allowed).toBe(true);
    expect(renewed.resetAt).toBe(121_000);
  });

  it("不同用户 / 不同功能的桶相互隔离", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    checkRateLimit("ask:u1", rule, 1000);
    expect(checkRateLimit("ask:u2", rule, 1000).allowed).toBe(true);
    expect(checkRateLimit("notes:u1", rule, 1000).allowed).toBe(true);
    // u1 的 ask 桶已被占满
    expect(checkRateLimit("ask:u1", rule, 1000).allowed).toBe(false);
  });

  it("被拒绝的请求持续计入窗口（刷接口不会提前解锁）", () => {
    const rule = { limit: 2, windowMs: 60_000 };
    checkRateLimit("ask:u1", rule, 1000);
    checkRateLimit("ask:u1", rule, 2000);
    // 连续刷 10 次，全部拒绝
    for (let index = 0; index < 10; index += 1) {
      expect(checkRateLimit("ask:u1", rule, 3000 + index).allowed).toBe(false);
    }
    // 窗口未结束仍拒绝
    expect(checkRateLimit("ask:u1", rule, 60_999).allowed).toBe(false);
  });

  it("预设规则满足预期量级", () => {
    expect(AI_RATE_LIMITS.ask.limit).toBeGreaterThan(0);
    expect(AI_RATE_LIMITS.notes.limit).toBeLessThan(AI_RATE_LIMITS.ask.limit);
    expect(AI_RATE_LIMITS.tags.limit).toBeGreaterThan(0);
  });
});
