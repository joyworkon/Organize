import { defineConfig, devices } from "@playwright/test";

/**
 * A03：真实后端协作 E2E 配置（COLLAB_E2E=1 门控的两个 spec）。
 *
 * 与默认 playwright.config.ts 分离：不用 webServer——服务由外部启动
 * （本地按 spec 头注释手动拉起；CI 由 ci.yml collab-e2e job 拉起全栈）：
 *   supabase start + 两个 seed 脚本 + collab-server(1420) + next start(3100, 真实后端)
 * 运行：COLLAB_E2E=1 npx playwright test -c playwright.collab.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(collab|anon-collab|synced-block)\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["line"],
    ["html", { output: "playwright-report", open: "never" }],
  ],
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
});
