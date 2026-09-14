import { describe, expect, it } from "vitest";
import { isPermanentlyGonePushStatus, nextRetryDelayMinutes } from "./push-delivery";

describe("isPermanentlyGonePushStatus", () => {
  it("404/410 视为永久失效（订阅撤销/过期）", () => {
    expect(isPermanentlyGonePushStatus(404)).toBe(true);
    expect(isPermanentlyGonePushStatus(410)).toBe(true);
  });

  it("可重试的临时错误不判永久", () => {
    expect(isPermanentlyGonePushStatus(429)).toBe(false);
    expect(isPermanentlyGonePushStatus(500)).toBe(false);
    expect(isPermanentlyGonePushStatus(503)).toBe(false);
    expect(isPermanentlyGonePushStatus(0)).toBe(false);
  });
});

describe("nextRetryDelayMinutes", () => {
  it("指数退避 2^n 分钟", () => {
    expect(nextRetryDelayMinutes(0)).toBe(1);
    expect(nextRetryDelayMinutes(1)).toBe(2);
    expect(nextRetryDelayMinutes(3)).toBe(8);
  });

  it("封顶 60 分钟（与 claim 的 attempt_count < 6 配合，重试 5 次后放弃）", () => {
    expect(nextRetryDelayMinutes(5)).toBe(32);
    expect(nextRetryDelayMinutes(6)).toBe(60);
    expect(nextRetryDelayMinutes(10)).toBe(60);
  });
});
