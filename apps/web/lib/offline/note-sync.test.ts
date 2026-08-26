// @vitest-environment jsdom
/**
 * X1 离线同步——保存失败分类与重试策略测试：
 * - nextRetryDelay：指数退避 1s→60s 封顶；
 * - isNetworkSaveError：网络类错误（无 code 的 fetch/network 失败）vs 服务端业务错误（带 code）；
 * - planSaveFailure：retry / wait-online / give-up 三分支。
 */
import { describe, expect, it } from "vitest";
import {
  isNetworkSaveError,
  MAX_SAVE_RETRIES,
  nextRetryDelay,
  planSaveFailure,
  RETRY_MAX_DELAY_MS,
} from "./note-sync";
import { isOnline, onNetworkChange } from "./network";

const NETWORK_ERR = { message: "Failed to fetch" }; // fetch 断网典型错误：无 code
const PG_ERR = { code: "23505", message: "duplicate key value" }; // Postgres 唯一约束
const PGRST_ERR = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" };

describe("nextRetryDelay：指数退避", () => {
  it("1s 起步，按 2 的幂增长", () => {
    expect(nextRetryDelay(0)).toBe(1_000);
    expect(nextRetryDelay(1)).toBe(2_000);
    expect(nextRetryDelay(2)).toBe(4_000);
    expect(nextRetryDelay(3)).toBe(8_000);
  });

  it("封顶 60s", () => {
    expect(nextRetryDelay(10)).toBe(RETRY_MAX_DELAY_MS);
    expect(nextRetryDelay(100)).toBe(RETRY_MAX_DELAY_MS);
  });

  it("非法输入回退到基础延时", () => {
    expect(nextRetryDelay(-1)).toBe(1_000);
    expect(nextRetryDelay(NaN)).toBe(1_000);
  });
});

describe("isNetworkSaveError：网络错误识别", () => {
  it("无 code 的 fetch/network 失败算网络错误", () => {
    expect(isNetworkSaveError(NETWORK_ERR)).toBe(true);
    expect(isNetworkSaveError({ message: "NetworkError when attempting to fetch resource." })).toBe(true);
    expect(isNetworkSaveError({ message: "Load failed" })).toBe(true);
    expect(isNetworkSaveError({ message: "signal timed out" })).toBe(true);
  });

  it("带错误码的服务端响应不算网络错误", () => {
    expect(isNetworkSaveError(PG_ERR)).toBe(false);
    expect(isNetworkSaveError(PGRST_ERR)).toBe(false);
  });

  it("空值/无 message 不算网络错误", () => {
    expect(isNetworkSaveError(null)).toBe(false);
    expect(isNetworkSaveError(undefined)).toBe(false);
    expect(isNetworkSaveError({})).toBe(false);
    expect(isNetworkSaveError("failed to fetch")).toBe(false);
  });
});

describe("planSaveFailure：失败后的下一步", () => {
  it("网络错误且在线且未超上限 → 按退避重试", () => {
    expect(planSaveFailure({ error: NETWORK_ERR, retries: 0, online: true }))
      .toEqual({ type: "retry", delayMs: 1_000 });
    expect(planSaveFailure({ error: NETWORK_ERR, retries: 3, online: true }))
      .toEqual({ type: "retry", delayMs: 8_000 });
  });

  it("网络错误但已离线 → 等 online 事件，不再定时重试", () => {
    expect(planSaveFailure({ error: NETWORK_ERR, retries: 0, online: false }))
      .toEqual({ type: "wait-online" });
  });

  it("网络错误重试达上限 → 放弃自动重试", () => {
    expect(planSaveFailure({ error: NETWORK_ERR, retries: MAX_SAVE_RETRIES, online: true }))
      .toEqual({ type: "give-up" });
  });

  it("非网络错误（4xx/业务错）→ 不自动重试", () => {
    expect(planSaveFailure({ error: PG_ERR, retries: 0, online: true }))
      .toEqual({ type: "give-up" });
    expect(planSaveFailure({ error: null, retries: 0, online: true }))
      .toEqual({ type: "give-up" });
  });
});

describe("network：在线状态工具", () => {
  it("jsdom 默认在线", () => {
    expect(isOnline()).toBe(true);
  });

  it("onNetworkChange 监听 online/offline 事件并返回取消函数", () => {
    const seen: boolean[] = [];
    const off = onNetworkChange((online) => seen.push(online));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(seen).toEqual([false, true]);
    off();
    window.dispatchEvent(new Event("offline"));
    expect(seen).toEqual([false, true]);
  });
});
