import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { BACKUP_TABLES, BACKUP_VERSION, BACKUP_FORMAT } from "../lib/backup/schema";

/**
 * 核心链路 smoke（P2-01）：mock 后端模式下跑通
 * 登录 → 稍后读保存 → 笔记保存后导航往返 → 任务完成 → 备份恢复（导出→空账户恢复）。
 *
 * mock 状态是页面 JS 内存库：SPA 导航保持，整页 reload 后重置为种子数据。
 * 因此「笔记刷新」用 SPA 历史往返模拟，备份恢复的持久化终点由
 * 真实后端 + vitest mock 客户端测试覆盖（mock 下断言恢复完成即止）。
 */

/** 首次引导浮层的 localStorage 键（components/onboarding.tsx） */
const ONBOARDED_KEY = "organize:onboarded";

/** 每个用例前置：预置「已完成引导」+ goto + 等待 React 水合完成 */
async function openPage(page: Page, path: string) {
  // 注意：addInitScript 在浏览器上下文执行，闭包引用不到 Node 模块常量，键名必须内联
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

test("登录：邮箱密码登录后进入阅读库", async ({ page }) => {
  await openPage(page, "/login");
  await page.getByPlaceholder("邮箱地址").fill("smoke@example.com");
  await page.getByPlaceholder("密码").fill("smoke-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/library/);
});

test("稍后读保存：粘贴链接回车保存，列表出现抓取标题", async ({ page }) => {
  await openPage(page, "/library");
  await page.getByLabel("快速添加链接").fill("https://example.com/playwright-smoke-article");
  const save = page.getByRole("button", { name: "保存", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  // mock 抓取从 slug 生成标题（Playwright smoke article）
  await expect(page.getByText("Playwright smoke article").first()).toBeVisible();
  await expect(page.getByText("已保存到稍后读").first()).toBeVisible();
});

test("笔记保存后导航往返：内容持久化", async ({ page }) => {
  await openPage(page, "/notes");
  await page.getByRole("button", { name: /新建笔记/ }).first().click();
  await page.waitForURL(/\/notes\//);

  const editor = page.locator(".tiptap, .ProseMirror").first();
  await editor.click();
  // tiptap 异步初始化：立即输入会被吞掉前几个字符，等挂载稳定后再打字
  await page.waitForTimeout(800);
  await page.keyboard.type("playwright-smoke-note-body");
  // 等待自动保存（编辑器 debounce 落库到 mock 内存库）
  await page.waitForTimeout(2500);

  // SPA 历史返回再前进：内存库不清空，验证已保存数据可回读
  await page.goBack();
  await expect(page.getByText(/playwright-smoke-note-body|无标题笔记/).first()).toBeVisible();
  await page.goForward();
  await expect(page.locator(".tiptap, .ProseMirror").first()).toContainText(
    "playwright-smoke-note-body",
    { timeout: 15_000 }
  );
});

test("任务完成：快速添加后勾选完成", async ({ page }) => {
  await openPage(page, "/tasks");
  await page.getByLabel("快速添加任务").fill("playwright-smoke-task");
  await page.keyboard.press("Enter");
  await expect(page.getByText("playwright-smoke-task").first()).toBeVisible();

  await page.getByLabel("标记完成").first().click();
  // 完成后行划线/状态徽标变化；乐观更新即时生效
  await expect(page.getByText("playwright-smoke-task").first()).toBeVisible();
  await expect(page.getByLabel("标记未完成").first()).toBeVisible();
});

test("备份恢复：校验合同 + 非空账户 409 拒绝", async ({ page }) => {
  // 正向「恢复到空账户」往返由 pgTAP 058（真实 RPC）覆盖；mock 模式下账户始终含
  // 种子数据（非空），本用例验证恢复 UI 链路：客户端 v4 校验 + 服务端 409 语义。
  await openPage(page, "/settings");

  // 构造一份 v4 合同合规的最小备份（全部表空 + 一条 reading_items）
  const row = {
    id: "e1f7a5c2-0000-4000-8000-000000000001",
    url: "https://example.com/e2e-restore-item",
    title: "E2E restore item",
    content: "<p>body</p>",
    excerpt: "body",
    cover_image: null,
    reading_status: "unread",
    reading_progress: 0,
    is_pinned: false,
    started_reading_at: null,
    completed_reading_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  // as Record<string, unknown[]>：备份 fixture 的行类型按表收窄太重，smoke 只需运行时形状
  const data = Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])) as Record<string, unknown[]>;
  data.reading_items = [row];
  const counts = Object.fromEntries(BACKUP_TABLES.map((t) => [t, 0]));
  counts.reading_items = 1;
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    manifest: {
      counts,
      // v4 合同要求的排除清单（schema.ts validateManifest 强制）
      excluded: ["auth", "plugins", "shares", "storage", "soft_deleted"],
    },
    data,
  };

  // 选择备份文件 → 客户端预检通过
  await page.getByRole("button", { name: "选择备份文件" }).click();
  await page.setInputFiles('input[type="file"]', {
    name: "organize-e2e-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText(/预检通过/)).toBeVisible();

  // 账户非空（mock 种子数据）→ 服务端 409 → UI 明确拒绝，不假成功
  await page.getByRole("button", { name: "确认恢复" }).click();
  await expect(
    page.getByText(/目标账户非空：恢复是整体替换语义，请先清空当前账户数据/)
  ).toBeVisible();
});

