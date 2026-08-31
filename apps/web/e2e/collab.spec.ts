import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * P5-03 双账号协作端到端验证（本地真实后端专用，COLLAB_E2E=1 才运行）。
 *
 * 前置（三个进程）：
 *   1. supabase start                     （真实后端）
 *   2. node scripts/seed-collab-e2e.mjs   （种子账号/笔记/授权）
 *   3. collab 服务：cd apps/collab-server && \
 *        SUPABASE_URL=… SUPABASE_ANON_KEY=… npx tsx src/server.ts
 *   4. web dev（真实后端 + 协作地址）：
 *        cd apps/web && NEXT_PUBLIC_COLLAB_WS_URL=ws://127.0.0.1:1420 \
 *          npx next dev -p 3100
 * 运行：COLLAB_E2E=1 npx playwright test e2e/collab.spec.ts
 *
 * 验证目标（ROADMAP P5-03）：双浏览器并发输入不丢字；断线（关页）重连后合并；
 * 快照落库后刷新内容仍在（版本/历史链路复用既有触发器）。
 */
// 本机 Playwright 浏览器版本不齐时，可用 COLLAB_E2E_CHROMIUM 指定既有 chromium 二进制
const collabChromium = process.env.COLLAB_E2E_CHROMIUM;

test.use({
  launchOptions: collabChromium ? { executablePath: collabChromium } : {},
});

test.describe("P5-03 双账号协作验证", () => {
  test.skip(process.env.COLLAB_E2E !== "1", "COLLAB_E2E=1 时才运行（需本地真实后端 + collab 服务）");

const seed = JSON.parse(readFileSync(".tmp-e2e/collab-seed.json", "utf8"));
const NOTE_URL = `/notes/${seed.noteId}`;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱地址").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/library");
  // 首次登录会有 onboarding 弹窗（拦截一切点击），Esc 关闭并写入已读标记
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function openNote(page: Page) {
  await page.goto(NOTE_URL);
  await page.locator(".ProseMirror").waitFor();
}

test("双浏览器并发编辑不丢字，重连后内容合并，快照落库可刷新恢复", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // 1. A、B 分别登录并打开同一篇笔记
  await login(pageA, seed.userA.email, seed.userA.password);
  await openNote(pageA);
  await login(pageB, seed.userB.email, seed.userB.password);
  await openNote(pageB);

  // 2. 并发输入：A 在第一个段落、B 在第二个段落（不同位置，模拟飞书式并行编辑）
  await pageA.locator(".ProseMirror > *").first().click();
  await pageA.keyboard.type("甲的并发输入A1");
  await pageB.locator(".ProseMirror > *").nth(1).click();
  await pageB.keyboard.type("乙的并发输入B1");
  await pageA.locator(".ProseMirror > *").first().click();
  await pageA.keyboard.type("A2");

  // 3. 双向可见：A 能看到乙的输入，B 能看到甲的输入（CRDT 合并，无冲突弹窗）
  await expect(pageA.locator(".ProseMirror")).toContainText("乙的并发输入B1", { timeout: 15_000 });
  await expect(pageB.locator(".ProseMirror")).toContainText("甲的并发输入A1A2", { timeout: 15_000 });

  // 4. 出席栏：双方都能看到对方在房间里（头像 chip 的 title = 对方名字）
  await expect(pageA.getByTitle("协作乙", { exact: true })).toBeVisible();
  await expect(pageB.getByTitle("协作甲", { exact: true })).toBeVisible();

  // 5. 快照落库：等节流保存窗口过后刷新，内容仍在（客户端快照 → v2 RPC → 触发器链）
  await pageA.waitForTimeout(3_000);
  await pageB.reload();
  await pageB.locator(".ProseMirror").waitFor();
  await expect(pageB.locator(".ProseMirror")).toContainText("甲的并发输入A1A2", { timeout: 15_000 });
  await expect(pageB.locator(".ProseMirror")).toContainText("乙的并发输入B1");

  // 6. 断线重连不丢字：B 关页（连接断开），A 继续输入；B 重开同一笔记，
  //    经服务端内存文档 + 快照双通道拿到全部内容
  await pageB.close(); // 只断开 B 的页面（连接断开），context 保留登录态
  await pageA.locator(".ProseMirror > *").first().click();
  await pageA.keyboard.type("以及重连前的A3");
  await pageA.waitForTimeout(3_000); // 让 A 的快照落库
  const pageB2 = await contextB.newPage();
  await openNote(pageB2);
  await expect(pageB2.locator(".ProseMirror")).toContainText("以及重连前的A3", { timeout: 15_000 });
  await expect(pageB2.locator(".ProseMirror")).toContainText("乙的并发输入B1");

  await contextA.close();
});
});
