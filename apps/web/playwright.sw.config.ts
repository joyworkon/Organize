import { defineConfig, devices } from "@playwright/test";

/**
 * A02 SW 跨版本更新 E2E：双构建 N→N+1 真实行为验证。
 * 与默认 playwright.config.ts 分离：不用 webServer——用例自己构建两个版本
 * （SW_BUILD_VERSION 不同 → sw.js 字节不同）并在中途换服务（见 e2e/sw-update.spec.ts）。
 * 运行：SW_E2E=1 npx playwright test -c playwright.sw.config.ts（package.json: e2e:sw）
 * CI 由 ci.yml 的 sw-e2e job 显式开启；默认 `pnpm e2e`（smoke）不跑本套件。
 */
export default defineConfig({
  testDir: "./e2e",
  // 只跑 SW 套件本身：smoke 走默认 playwright.config.ts（有 webServer，本配置没有）
  testMatch: /sw-update\.spec\.ts/,
  timeout: 420_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
