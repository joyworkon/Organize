import { defineConfig, devices } from "@playwright/test";

/**
 * 核心链路 smoke（P2-01）：mock 后端模式（NEXT_PUBLIC_MOCK_BACKEND=true），
 * 无需真实 Supabase 即可跑通登录 → 稍后读保存 → 笔记保存后刷新 → 任务完成 → 备份恢复。
 * CI 在 `next build`（mock env）+ `next start` 后运行；本地 `pnpm e2e` 同样可用。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx next start -p 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NEXT_PUBLIC_MOCK_BACKEND: "true",
      // env 校验逃生舱：next start 固定 production，E2E harness 显式自证身份
      ORGANIZE_E2E: "true",
      // mock 模式不需要有效 Supabase，但 createBrowserClient 需要变量存在
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
    },
  },
});
