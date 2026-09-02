import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// seed 文件由 scripts/seed-anon-e2e.mjs 生成，仅在本地真实后端验证时存在；
// 懒加载：模块顶层不读文件，避免未启用协作验证的环境（如 CI）加载即炸
let seed: { noteId: string; editToken: string; readToken: string };

/**
 * 072 匿名可编辑公开链接端到端验证（本地真实后端专用，COLLAB_E2E=1 才运行）。
 *
 * 前置（三个进程）：
 *   1. supabase start                     （真实后端）
 *   2. node scripts/seed-anon-e2e.mjs     （属主笔记 + public_edit/public_read 分享）
 *   3. collab 服务：cd apps/collab-server && \
 *        SUPABASE_URL=… SUPABASE_ANON_KEY=… npx tsx src/server.ts
 *   4. web dev（真实后端 + 协作地址）：
 *        cd apps/web && NEXT_PUBLIC_COLLAB_WS_URL=ws://127.0.0.1:1420 \
 *          npx next dev -p 3100
 * 运行：COLLAB_E2E=1 npx playwright test e2e/anon-collab.spec.ts
 *
 * 验证目标（任务书 Track B 验收）：两个未登录浏览器打开同一 public_edit 链接，
 * 并发输入不丢字、远端光标（访客标签）可见；public_read 链接不可编辑；刷新内容仍在
 * （blob + 快照双通道）。taskItem 勾选禁用由组件级单测钉住
 * （components/editor/extensions/task-item-toggle-guard.test.ts）。
 */
// 本机 Playwright 浏览器版本不齐时，可用 COLLAB_E2E_CHROMIUM 指定既有 chromium 二进制
const collabChromium = process.env.COLLAB_E2E_CHROMIUM;

test.use({
  launchOptions: collabChromium ? { executablePath: collabChromium } : {},
});

test.describe("072 匿名公开链接实时协同", () => {
  test.skip(process.env.COLLAB_E2E !== "1", "COLLAB_E2E=1 时才运行（需本地真实后端 + collab 服务）");

  test.beforeAll(async () => {
    seed = JSON.parse(readFileSync(".tmp-e2e/anon-seed.json", "utf8"));
  });

  const editUrl = () => `/s/${seed.editToken}`;
  const readUrl = () => `/s/${seed.readToken}`;

  async function openEditor(page: Page, url: string) {
    await page.goto(url);
    await page.locator(".ProseMirror").waitFor({ timeout: 20_000 });
    // 等实时会话就绪：「正在进入实时会话…」消失（provider 已挂上、编辑器已重建）
    await page
      .getByText("正在进入实时会话…")
      .waitFor({ state: "detached", timeout: 20_000 });
  }

  test("双匿名浏览器并发编辑不丢字，远端光标可见，刷新内容仍在", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 1. 两个未登录浏览器打开同一 public_edit 链接
    await openEditor(pageA, editUrl());
    await openEditor(pageB, editUrl());

    // 2. 并发输入：A 在第一段、B 在第二段
    await pageA.locator(".ProseMirror > *").first().click();
    await pageA.keyboard.type("访客A的输入A1");
    await pageA.keyboard.type("A2");
    await pageB.locator(".ProseMirror > *").nth(1).click();
    await pageB.keyboard.type("访客B的输入B1");

    // 3. 双向可见（CRDT 合并，无登录无冲突弹窗）
    await expect(pageA.locator(".ProseMirror")).toContainText("访客B的输入B1", { timeout: 15_000 });
    await expect(pageB.locator(".ProseMirror")).toContainText("访客A的输入A1A2", { timeout: 15_000 });

    // 4. 远端光标可见：对方出席名「访客」的 cursor 标签出现在本端编辑器里
    await expect(pageA.locator(".collaboration-cursor__label").first()).toHaveText("访客", {
      timeout: 15_000,
    });
    await expect(pageB.locator(".collaboration-cursor__label").first()).toHaveText("访客", {
      timeout: 15_000,
    });

    // 5. 刷新后内容仍在（快照节流落库 → save_public_note；blob 经 collab-server）
    await pageA.waitForTimeout(3_500);
    await pageB.reload();
    await openEditor(pageB, editUrl());
    await expect(pageB.locator(".ProseMirror")).toContainText("访客A的输入A1A2", { timeout: 15_000 });
    await expect(pageB.locator(".ProseMirror")).toContainText("访客B的输入B1");

    await contextA.close();
  });

  test("public_read 链接不可编辑（保持静态只读页）", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(readUrl());
    // 只读分支渲染静态 HTML，不出现可编辑的 ProseMirror 实例
    await expect(page.locator("article.organize-editor")).toBeVisible();
    await expect(page.locator(".ProseMirror")).toHaveCount(0);
    await expect(page.locator("article")).toContainText("属主播种内容");
    await context.close();
  });
});
