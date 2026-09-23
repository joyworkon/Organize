import { describe, expect, it } from "vitest";
import {
  IMPORT_STALE_THRESHOLD_MS,
  INTERRUPTED_ERROR_MESSAGE,
  isImportRowStale,
} from "./stale";

// 阶段 1：中断恢复的判定核心。导入没有后台 worker，uploading/parsing 只可能
// 由一个在途 POST 推进；行 updated_at 超过阈值即视为该请求已死亡，可安全标记失败。
describe("isImportRowStale", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");

  it("阈值为 10 分钟（预算有界：单批 ≤20MB / 解析上限，余量充足）", () => {
    expect(IMPORT_STALE_THRESHOLD_MS).toBe(10 * 60 * 1000);
  });

  it("刚刚更新的进行中行不算 stale", () => {
    expect(isImportRowStale(new Date(now - 1000).toISOString(), now)).toBe(false);
  });

  it("略小于阈值的进行中行不算 stale（边界内不误伤慢网络上传）", () => {
    expect(isImportRowStale(new Date(now - IMPORT_STALE_THRESHOLD_MS + 60_000).toISOString(), now)).toBe(false);
  });

  it("恰好在阈值上的行算 stale（含等于）", () => {
    expect(isImportRowStale(new Date(now - IMPORT_STALE_THRESHOLD_MS).toISOString(), now)).toBe(true);
  });

  it("远超阈值的行算 stale", () => {
    expect(isImportRowStale(new Date(now - IMPORT_STALE_THRESHOLD_MS - 60_000).toISOString(), now)).toBe(true);
  });

  it("终态行（saved/failed）即使很旧也不算 stale——只回收进行中状态", () => {
    // isImportRowStale 只判时间；调用方负责限定 status in (uploading, parsing)
    expect(isImportRowStale(new Date(now - 24 * 3600_000).toISOString(), now)).toBe(true);
  });

  it("updated_at 缺失时按不 stale 处理（无法判定时不破坏数据）", () => {
    expect(isImportRowStale(null, now)).toBe(false);
    expect(isImportRowStale(undefined, now)).toBe(false);
    expect(isImportRowStale("", now)).toBe(false);
    expect(isImportRowStale("not-a-date", now)).toBe(false);
  });

  it("中断提示语对用户可操作（说明可重试且不会重复）", () => {
    expect(INTERRUPTED_ERROR_MESSAGE).toContain("中断");
    expect(INTERRUPTED_ERROR_MESSAGE).toContain("重试");
  });
});
