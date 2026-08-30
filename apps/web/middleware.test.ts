import { describe, expect, it } from "vitest";
import { isAuthExemptPath } from "./middleware";

/**
 * 免登录豁免判定（P2-03）：真实后端下 /api/health 与 /api/cron/* 的调用方
 * 都没有 Supabase session cookie（部署平台探活、GitHub Actions 带 Bearer）。
 * 一旦被重定向到 /login，探活失效、提醒链路整体不可用；
 * CI 的 mock smoke 因中间件在 mock 下整体跳过鉴权而覆盖不到这条路径。
 */
describe("isAuthExemptPath", () => {
  it("放行无 session 的服务端调用方", () => {
    expect(isAuthExemptPath("/api/health")).toBe(true);
    expect(isAuthExemptPath("/api/cron/task-reminders")).toBe(true);
  });

  it("放行既有的公开入口", () => {
    expect(isAuthExemptPath("/login")).toBe(true);
    expect(isAuthExemptPath("/auth/callback")).toBe(true);
    expect(isAuthExemptPath("/s/abc123")).toBe(true);
  });

  it("不放行同前缀的其它路径（health 精确匹配）", () => {
    expect(isAuthExemptPath("/api/healthz")).toBe(false);
    expect(isAuthExemptPath("/api/health/detail")).toBe(false);
    expect(isAuthExemptPath("/api/cron")).toBe(false);
  });

  it("受保护的数据接口与页面仍需登录", () => {
    expect(isAuthExemptPath("/library")).toBe(false);
    expect(isAuthExemptPath("/api/reading-items")).toBe(false);
    expect(isAuthExemptPath("/api/account")).toBe(false);
  });
});
