import { describe, expect, it } from "vitest";
import { hasFatal, validateEnv } from "./env";

const BASE = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://sup.example.com",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ.valid.key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  CRON_SECRET: "cron-secret",
};

describe("validateEnv（P2-02 启动校验）", () => {
  it("生产环境完整配置 → 无问题", () => {
    expect(validateEnv(BASE)).toEqual([]);
  });

  it("红线：生产 + mock=true → fatal，hasFatal 为真（拒绝启动）", () => {
    const issues = validateEnv({ ...BASE, NEXT_PUBLIC_MOCK_BACKEND: "true" });
    expect(hasFatal(issues)).toBe(true);
    expect(issues.find((i) => i.key === "NEXT_PUBLIC_MOCK_BACKEND")?.level).toBe("fatal");
  });

  it("E2E harness（ORGANIZE_E2E=true）production+mock → 降级 warn 不拦启动", () => {
    const issues = validateEnv({
      ...BASE,
      NEXT_PUBLIC_MOCK_BACKEND: "true",
      ORGANIZE_E2E: "true",
    });
    expect(hasFatal(issues)).toBe(false);
    expect(issues.find((i) => i.key === "NEXT_PUBLIC_MOCK_BACKEND")?.level).toBe("warn");
  });

  it("开发 + mock=true → 仅 warn 不拦启动", () => {
    const issues = validateEnv({
      ...BASE,
      NODE_ENV: "development",
      NEXT_PUBLIC_MOCK_BACKEND: "true",
    });
    expect(hasFatal(issues)).toBe(false);
    expect(issues.find((i) => i.key === "NEXT_PUBLIC_MOCK_BACKEND")?.level).toBe("warn");
  });

  it("生产缺 Supabase URL / anon key → fatal", () => {
    const missingUrl = validateEnv({ ...BASE, NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect(missingUrl.find((i) => i.key === "NEXT_PUBLIC_SUPABASE_URL")?.level).toBe("fatal");

    const missingKey = validateEnv({ ...BASE, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined });
    expect(missingKey.find((i) => i.key === "NEXT_PUBLIC_SUPABASE_ANON_KEY")?.level).toBe("fatal");
  });

  it("mock 模式生产构建不要求真实 Supabase 键 fatal（本地构建场景）", () => {
    const issues = validateEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_MOCK_BACKEND: "true",
    });
    // mock 是 fatal 本身已拦；Supabase 键缺失不额外报 fatal
    expect(issues.find((i) => i.key === "NEXT_PUBLIC_SUPABASE_URL")).toBeUndefined();
    expect(issues.find((i) => i.key === "NEXT_PUBLIC_SUPABASE_ANON_KEY")).toBeUndefined();
  });

  it("缺 service role key / CRON_SECRET → warn（功能受限不拦启动）", () => {
    const issues = validateEnv({
      ...BASE,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      CRON_SECRET: undefined,
    });
    expect(hasFatal(issues)).toBe(false);
    expect(issues.map((i) => i.key).sort()).toEqual(["CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(issues.every((i) => i.level === "warn")).toBe(true);
  });

  it("开发环境缺 Supabase 键 → warn 不拦启动", () => {
    const issues = validateEnv({
      NODE_ENV: "development",
      NEXT_PUBLIC_MOCK_BACKEND: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    });
    expect(hasFatal(issues)).toBe(false);
  });
});
