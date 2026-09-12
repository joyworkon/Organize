import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * A04：同步块双浏览器可靠性（真实后端，REAL_DB_E2E=1 才运行）。
 *
 * 前置（服务由外部拉起，见 playwright.collab.config.ts 头注释与 ci.yml collab-e2e job）：
 *   supabase start → seed-collab-e2e.mjs → seed-synced-block-e2e.mjs → next start(3100, 真实后端)
 * 运行：REAL_DB_E2E=1 npx playwright test -c playwright.collab.config.ts e2e/synced-block.spec.ts
 *
 * 覆盖场景（计划卡 A04 / R05 §9 遗留缺口）：
 *   1) 旧 hydrated=true 不被信任：挂载必拉服务端，过期快照被替换
 *   2) 两页引用同块：一页改、另一页聚焦后拿到新内容（跨设备路径：focus→GET）
 *   3) 并发分叉不自动覆盖：离线改 A / 在线改 B → 回线后 stale 提示 + 双方内容可找回
 *   4) 断网改 → 关页 → 重开：pending 恢复、内容可找回、上线重试收敛
 *   5) 响应丢失幂等命中：PATCH 已写库但响应被丢弃 → 重试 409 → 幂等收敛不重复写
 *   6) localStorage 配额失败不阻塞同步（内存 pending 兜底）
 *   7) 无权视角降级（撤权等价态）：B 经空间授权能读笔记，但 RLS 拿不到 synced_blocks；
 *      B 的编辑不得改动 A 的服务端内容，且不得假成功
 */

let seed: {
  syncedId: string;
  note1Id: string;
  note2Id: string;
  userA: { email: string; password: string };
  userB: { email: string; password: string };
};

test.skip(process.env.REAL_DB_E2E !== "1", "REAL_DB_E2E=1 时运行（需本地真实后端 + 两个 seed）");

/** 每轮唯一后缀：同一本地库的块内容跨轮残留，断言只认本轮输入 */
const RUN = `·${Date.now().toString(36)}`;
const t = (s: string) => `${s}${RUN}`;

test.beforeAll(() => {
  seed = JSON.parse(readFileSync(".tmp-e2e/synced-block-seed.json", "utf8"));
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱地址").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/library");
  await page.keyboard.press("Escape"); // 关 onboarding 弹窗
  await page.waitForTimeout(300);
}

/** 打开笔记并等同步块工具栏出现（挂载拉取完成） */
async function openNote(page: Page, noteId: string) {
  await page.goto(`/notes/${noteId}`);
  await page.locator(".ProseMirror").waitFor();
  await page.locator(`[data-synced-id="${seed.syncedId}"]`).waitFor();
}

/** 同步块内容段落（可编辑区） */
const blockContent = (page: Page) =>
  page.locator(`[data-synced-id="${seed.syncedId}"] .organize-synced-content`);

/** 在块内末尾输入：点最后一段的右下角定位到段尾再输入。
 *  不能点中心 + End：块内容跨用例累积变长后折行，End 只到「可视行尾」，
 *  输入会落到段落中间（A04 实测：文字插进上一用例文本的内里） */
async function typeInBlock(page: Page, text: string) {
  const para = blockContent(page).locator("p").last();
  const box = await para.boundingBox();
  if (!box) throw new Error("block last paragraph not visible");
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 4);
  await page.keyboard.type(text);
}

/** 模拟用户聚焦标签页：headless 下 bringToFront 不派发 window focus，
 *  而同步块的跨设备刷新依赖 focus/visibilitychange（真实浏览器里聚焦即触发） */
async function focusTab(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** 等 SW 接管本页：之后整页加载的笔记 HTML 才会进缓存，
 *  断网重开（测试 4）依赖这条缓存路径而不是 offline 回退 */
async function waitForController(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
}

const toolbarStatus = (page: Page, text: string) =>
  page
    .locator(`[data-synced-id="${seed.syncedId}"] .organize-synced-toolbar`)
    // 不用 exact：stale/conflict 状态 span 内还包含操作按钮，整段文本不等于状态词
    .getByText(text);

/** 收敛到已同步：轮询驱动显式动作直到收敛。一次性 isVisible 检查会撞上
 *  过渡态（挂载拉取/pending 回放之间工具栏短暂无动作按钮），之后 stale
 *  出现就无人处理 → 干等超时（A04 实测）。只允许显式动作，不允许静默路径 */
async function convergeToSynced(page: Page, syncedId: string) {
  const toolbar = page.locator(`[data-synced-id="${syncedId}"] .organize-synced-toolbar`);
  for (let i = 0; i < 40; i++) {
    if (await toolbar.getByText("已同步").isVisible().catch(() => false)) return;
    const overwrite = toolbar.getByText("用本地覆盖");
    const retry = toolbar.getByText("重试", { exact: true });
    if (await overwrite.isVisible().catch(() => false)) {
      await overwrite.click();
    } else if (await retry.isVisible().catch(() => false)) {
      await retry.click();
    }
    await page.waitForTimeout(500);
  }
  await expect(toolbar.getByText("已同步")).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("同步块双浏览器可靠性（真实后端）", () => {
  test("旧 hydrated=true 不被信任：挂载必拉服务端内容", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, seed.userA.email, seed.userA.password);
    await openNote(page, seed.note1Id);

    // 种子里 SB1 的 JSON 快照是「不应出现的旧快照段落」+ hydrated=true：
    // 组件忽略旧值从服务端拉取 → 必须显示服务端两段
    await expect(blockContent(page)).toContainText("同步块服务端第一段", { timeout: 15_000 });
    await expect(blockContent(page)).toContainText("服务端第二段");
    await expect(blockContent(page)).not.toContainText("不应出现的旧快照段落");
    await expect(toolbarStatus(page, "已同步")).toBeVisible();
    await context.close();
  });

  test("两页引用同块：页二编辑 → 页一聚焦后拿到新内容；摘要事件一致", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await login(pageA, seed.userA.email, seed.userA.password);
    await login(pageB, seed.userA.email, seed.userA.password);
    await openNote(pageA, seed.note1Id);
    await openNote(pageB, seed.note2Id);
    await expect(toolbarStatus(pageB, "已同步")).toBeVisible();

    // 页二编辑：pending 立即出现（页面摘要「1 个同步块待同步」），防抖后落库清除
    await typeInBlock(pageB, t("页二新增段落"));
    await expect(pageB.getByText("1 个同步块待同步")).toBeVisible();
    await expect(toolbarStatus(pageB, "已同步")).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText("1 个同步块待同步")).toBeHidden();

    // 页一聚焦（跨设备路径：window focus → GET → 应用新内容）
    await focusTab(pageA);
    await expect(blockContent(pageA)).toContainText(t("页二新增段落"), { timeout: 15_000 });
    await ctxA.close();
    await ctxB.close();
  });

  test("并发分叉不自动覆盖：离线改 A / 在线改 B → 回线 stale + 显式动作收敛", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await login(pageA, seed.userA.email, seed.userA.password);
    await login(pageB, seed.userA.email, seed.userA.password);
    await openNote(pageA, seed.note1Id);
    await openNote(pageB, seed.note2Id);
    await expect(toolbarStatus(pageA, "已同步")).toBeVisible();
    await expect(toolbarStatus(pageB, "已同步")).toBeVisible();

    // A 断网改（pending 落 localStorage）；B 在线改（服务端 revision 前进）
    await ctxA.setOffline(true);
    await typeInBlock(pageA, t("甲离线改动"));
    await pageA.waitForTimeout(2500); // 等 pending 持久化
    await typeInBlock(pageB, t("乙在线改动"));
    await expect(toolbarStatus(pageB, "已同步")).toBeVisible({ timeout: 15_000 });

    // A 回线：可见性刷新发现远端分叉 → stale 提示，本地内容不被覆盖。
    // 先等过 5 秒节流窗：online 事件触发的刷新可能撞上网络未完全恢复而失败，
    // 紧随的 focus 刷新会被节流挡掉（真实用户会再次聚焦标签页，等价补一次）
    await ctxA.setOffline(false);
    await pageA.waitForTimeout(6_000);
    await focusTab(pageA);
    await expect(toolbarStatus(pageA, "远端有更新")).toBeVisible({ timeout: 15_000 });
    await expect(blockContent(pageA)).toContainText(t("甲离线改动"));
    await expect(blockContent(pageA)).not.toContainText(t("乙在线改动"));

    // 显式「用本地覆盖」→ 服务端收敛为 A 的内容；B 聚焦后拿到
    await toolbarStatus(pageA, "用本地覆盖").click();
    await expect(toolbarStatus(pageA, "已同步")).toBeVisible({ timeout: 15_000 });
    await focusTab(pageB);
    await expect(blockContent(pageB)).toContainText(t("甲离线改动"), { timeout: 15_000 });
    await ctxA.close();
    await ctxB.close();
  });

  test("断网改 → 关页 → 重开：pending 恢复、上线重试收敛", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, seed.userA.email, seed.userA.password);
    // 先等 SW 接管本页：离线重开依赖「在线时加载的笔记 HTML 已进缓存」，
    // 无 controller 时加载的页面不进缓存 → 离线重开会落到 offline.html
    await waitForController(page);
    await openNote(page, seed.note2Id);
    await expect(toolbarStatus(page, "已同步")).toBeVisible();

    await context.setOffline(true);
    await typeInBlock(page, t("断网重开改动"));
    await page.waitForTimeout(2500); // 等 note 草稿 + 块 pending 落 localStorage
    await page.close();

    // 仍离线重开：产品合同（X1-2B）是「离线暂不可读/不存在」失败卡片而非草稿
    // 恢复——SW 缓存的页面壳 + 数据不可达。emulated offline 下 SW 控制的页面
    // navigator.onLine 不保证为 false，两种失败文案都要接受（无编辑器是关键）
    const page2 = await context.newPage();
    await page2.goto(`/notes/${seed.note2Id}`);
    await expect(
      page2.getByRole("heading", { name: "离线暂不可读" }).or(page2.getByRole("heading", { name: "笔记不存在" }))
    ).toBeVisible({ timeout: 15_000 });

    // 回网重开：远端内容渲染；本地草稿与远端不同 → 恢复对话框（有则点恢复，
    // 走真实用户路径；块 pending 自身的收敛不依赖这一步）
    await context.setOffline(false);
    await page2.waitForTimeout(1000);
    const page3 = await context.newPage();
    await openNote(page3, seed.note2Id);
    const restore = page3.getByRole("button", { name: "恢复本地草稿" });
    if (await restore.isVisible().catch(() => false)) {
      await restore.click();
    }
    await expect(blockContent(page3)).toContainText(t("断网重开改动"), { timeout: 15_000 });

    // 块 pending 回线收敛：轮询驱动显式动作，不允许静默路径
    await convergeToSynced(page3, seed.syncedId);

    // 服务器真有这次内容：新开干净页面验证
    const page4 = await context.newPage();
    await openNote(page4, seed.note2Id);
    await expect(blockContent(page4)).toContainText(t("断网重开改动"), { timeout: 15_000 });
    await context.close();
  });

  test("响应丢失幂等命中：PATCH 已写库但响应丢弃 → 重试 409 → 幂等收敛", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, seed.userA.email, seed.userA.password);
    await openNote(page, seed.note1Id);
    await expect(toolbarStatus(page, "已同步")).toBeVisible();

    // 拦截第一次 PATCH：请求照常到达服务端，响应丢弃（模拟网络响应丢失）
    let droppedOnce = false;
    await page.route("**/api/synced-blocks/*", async (route) => {
      if (route.request().method() === "PATCH" && !droppedOnce) {
        droppedOnce = true;
        await route.fetch(); // 服务端已处理（revision 前进、内容写库）
        await route.abort(); // 但客户端收到失败
        return;
      }
      await route.continue();
    });

    await typeInBlock(page, t("丢失响应改动"));
    // 防抖 flush：服务端已写入，但本页看到失败 → 同步失败 + pending 保留
    await expect(toolbarStatus(page, "同步失败")).toBeVisible({ timeout: 15_000 });
    // 显式重试 → 409 且 current == pending → 幂等命中 → 已同步（不重复写、revision 不再前进）
    await toolbarStatus(page, "重试").click();
    await expect(toolbarStatus(page, "已同步")).toBeVisible({ timeout: 15_000 });
    await page.unroute("**/api/synced-blocks/*");

    // 服务器内容确为该次编辑
    const page2 = await context.newPage();
    await openNote(page2, seed.note1Id);
    await expect(blockContent(page2)).toContainText(t("丢失响应改动"), { timeout: 15_000 });
    await context.close();
  });

  test("localStorage 配额失败不阻塞：内存 pending 兜底，服务器仍同步成功", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, seed.userA.email, seed.userA.password);
    await openNote(page, seed.note2Id);
    await expect(toolbarStatus(page, "已同步")).toBeVisible();

    // 塞满 localStorage（setItem 抛 QuotaExceededError → writeSyncedPending 返回 false）
    await page.evaluate(() => {
      try {
        localStorage.setItem("organize:e2e-quota-filler", "x".repeat(5 * 1024 * 1024));
      } catch {
        /* 已满即可 */
      }
    });

    await typeInBlock(page, t("配额不足改动"));
    // 内存 pending 照常 flush：块到达已同步（页面摘要同理由内存 pending 驱动）
    await expect(toolbarStatus(page, "已同步")).toBeVisible({ timeout: 15_000 });

    await page.evaluate(() => localStorage.removeItem("organize:e2e-quota-filler"));
    const page2 = await context.newPage();
    await openNote(page2, seed.note2Id);
    await expect(blockContent(page2)).toContainText(t("配额不足改动"), { timeout: 15_000 });
    await context.close();
  });

  test("无权视角（撤权等价态）：B 可读笔记但拿不到同步块，编辑不落库不假成功", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await login(pageA, seed.userA.email, seed.userA.password);
    await login(pageB, seed.userB.email, seed.userB.password);

    // B 经空间 editor 授权打开 note1：页面渲染、块内嵌快照可见（内容随笔记 JSON 分发）
    await openNote(pageB, seed.note1Id);
    await expect(blockContent(pageB)).toContainText("同步块服务端第一段", { timeout: 15_000 });

    // B 编辑块：RLS 拿不到 synced_blocks 行 → PATCH 404 → 同步失败（不得假成功）
    await typeInBlock(pageB, t("乙越权改动"));
    await expect(toolbarStatus(pageB, "同步失败")).toBeVisible({ timeout: 15_000 });

    // A 的服务端内容不被 B 的改动影响
    await openNote(pageA, seed.note1Id);
    await expect(toolbarStatus(pageA, "已同步")).toBeVisible({ timeout: 15_000 });
    await expect(blockContent(pageA)).not.toContainText(t("乙越权改动"));
    await expect(blockContent(pageA)).toContainText("同步块服务端第一段");
    await ctxA.close();
    await ctxB.close();
  });
});
