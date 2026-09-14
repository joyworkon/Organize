import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// seed 文件由 scripts/seed-backlinks-e2e.mjs 生成，仅在真实后端验证时存在；
// 懒加载：模块顶层不读文件，避免未启用协作验证的环境（如 CI）加载即炸
let seed: { targetId: string; sourceId: string; userA: { email: string; password: string } };

/**
 * B03-4 反链读路径切读（v2）端到端冒烟（本地真实后端专用，COLLAB_E2E=1 才运行）。
 *
 * 前置（与 collab.spec 相同的全栈，本 spec 不依赖 collab-server）：
 *   1. supabase start
 *   2. node scripts/seed-collab-e2e.mjs && node scripts/seed-backlinks-e2e.mjs
 *   3. web（真实后端）：cd apps/web && npx next dev -p 3100（或 CI 的生产构建 start）
 * 运行：COLLAB_E2E=1 npx playwright test -c playwright.collab.config.ts
 *
 * 验证目标：客户端 fetchAllNoteBacklinks 切到 get_note_backlinks_v2（078 索引 +
 * 稳定游标）后，笔记详情页反链面板展示来源笔记标题——真实后端全链路冒烟。
 */
test.describe("B03 反链读路径（v2 切读）", () => {
  test.skip(process.env.COLLAB_E2E !== "1", "COLLAB_E2E=1 时才运行（需本地真实后端 + 种子）");

  test.beforeAll(async () => {
    seed = JSON.parse(readFileSync(".tmp-e2e/backlinks-seed.json", "utf8"));
  });

  async function login(page: Page) {
    // 预置「已完成引导」标记（同 smoke.spec）：引导浮层会拦截点击，
    // Escape 时机不稳（CI 实测浮层残留挡住后续点击）
    await page.addInitScript(() => {
      window.localStorage.setItem("organize:onboarded", "1");
    });
    await page.goto("/login");
    await page.getByPlaceholder("邮箱地址").fill(seed.userA.email);
    await page.getByPlaceholder("密码").fill(seed.userA.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL("**/library");
  }

  test("打开被引用笔记，反链面板列出来源标题", async ({ page }) => {
    await login(page);
    await page.goto(`/notes/${seed.targetId}`);
    // 反链面板（components/notes/backlinks.tsx）。「反向链接」小节 + 来源标题。
    // 30s 容忍 dev 模式首次冷编译（CI 生产构建无此开销）。
    // 断言全部作用域到面板：侧边栏笔记列表会以同名标题出现同名元素（CI 实测 strict
    // violation：📄 侧边栏项 + 面板行两个命中）
    const panel = page.getByTestId("backlinks-panel");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("反向链接")).toBeVisible();
    await expect(panel.getByText("反链来源笔记")).toBeVisible();
    // 来源行可点击跳转
    await panel.getByText("反链来源笔记").click();
    await expect(page).toHaveURL(new RegExp(`/notes/${seed.sourceId}`));
  });
});
