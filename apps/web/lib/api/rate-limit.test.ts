import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "./rate-limit";

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
