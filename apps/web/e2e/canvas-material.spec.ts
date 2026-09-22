import { expect, test, type Page } from "@playwright/test";

/**
 * 资料库 ↔ 画布联动（阶段 E）e2e：mock 后端模式下验证
 * 资料库「添加到画布」（新建画布路径 + 快照卡片可见）、
 * 画布「资料」面板（搜索 → 引用卡片 / 插入摘录）、
 * 快照独立性（画布修改不回写原资料，任务书验收 22）。
 */

async function openPage(page: Page, path: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

async function saveMemo(page: Page, text: string) {
  await page.getByLabel("资料库统一输入").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByText("已保存为速记").first()).toBeVisible();
}

test("资料库「添加到画布」→ 新建画布 → 快照卡片可见（标题 + 来源行）", async ({ page }) => {
  await openPage(page, "/library");
  await saveMemo(page, "E2E 画布联动标题\n\n这段正文会被引用进画布。");

  const card = page.getByRole("link", { name: /E2E 画布联动标题/ }).first();
  await card.getByRole("button", { name: /添加到画布/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("选择画布")).toHaveValue("__new__");
  await dialog.getByRole("button", { name: "添加" }).click();

  await expect(page.getByText("已添加到画布").first()).toBeVisible();
  await page.getByRole("link", { name: "打开画布查看 →" }).click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();

  // 快照卡片：标题 + 摘录 + 来源行（速记徽标）
  const cardBlock = page.locator("[data-block-type='materialCard']");
  await expect(cardBlock).toBeVisible();
  await expect(cardBlock.locator(".canvas-material-card-title")).toHaveText("E2E 画布联动标题");
  await expect(cardBlock.getByText(/这段正文会被引用进画布。/)).toBeVisible();
  await expect(cardBlock.getByText("速记", { exact: true })).toBeVisible();
});

test("快照独立性：画布改卡片标题，原速记不变（验收 22）", async ({ page }) => {
  await openPage(page, "/library");
  await saveMemo(page, "快照独立性标题\n\n原文内容保持不变。");

  await page
    .getByRole("link", { name: /快照独立性标题/ })
    .first()
    .getByRole("button", { name: /添加到画布/ })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "添加" }).click();
  await page.getByRole("link", { name: "打开画布查看 →" }).click();
  await page.waitForURL(/\/canvas\//);

  // 选中卡片 → 属性栏改标题（快照副本编辑）
  const cardBlock = page.locator("[data-block-type='materialCard']");
  await cardBlock.click();
  const titleInput = page.getByLabel("卡片标题");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("画布内改过的标题");
  await expect(cardBlock.locator(".canvas-material-card-title")).toHaveText("画布内改过的标题");

  // 原速记不变（SPA 内导航，避免整页刷新清空 mock 内存数据）
  await page.locator("nav").first().getByRole("link", { name: "资料库" }).click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByText("快照独立性标题").first()).toBeVisible();
  await expect(page.getByText("画布内改过的标题")).toHaveCount(0);
});

test("画布「资料」面板：搜索 → 引用卡片 / 插入摘录（带来源引用）", async ({ page }) => {
  // 先有资料：保存一条速记
  await openPage(page, "/library");
  await saveMemo(page, "面板搜索目标标题\n\n用于资料面板引用的正文。");

  // 新建画布并建一个页面（双击）；SPA 内导航保留 mock 内存数据
  await page.locator("nav").first().getByRole("link", { name: "构思画布" }).click();
  await expect(page).toHaveURL(/\/canvas$/);
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await page.getByTestId("canvas-viewport").dblclick({ position: { x: 300, y: 260 } });
  await expect(page.locator("[data-board-id]").first()).toBeVisible();

  // 打开「资料」折叠组并搜索
  await page.getByRole("button", { name: "资料" }).click();
  const panel = page.getByTestId("canvas-material-panel");
  await expect(panel).toBeVisible();
  await panel.getByLabel("搜索资料").fill("面板搜索目标");
  await expect(panel.getByLabel(/预览速记：面板搜索目标标题/)).toBeVisible({ timeout: 10000 });

  // 引用卡片
  await panel.getByLabel(/预览速记：面板搜索目标标题/).click();
  await panel.getByRole("button", { name: "引用整条资料卡片" }).click();
  const cardBlock = page.locator("[data-block-type='materialCard']");
  await expect(cardBlock.locator(".canvas-material-card-title")).toHaveText("面板搜索目标标题");

  // 插入摘录（无选区 → 完整摘要），正文块带来源引用 → 属性栏显示来源区
  await panel.getByRole("button", { name: /插入选中的文字摘录/ }).click();
  const excerptBlock = page.locator("[data-block-type='text']", { hasText: "用于资料面板引用的正文。" });
  await expect(excerptBlock).toBeVisible();
  await excerptBlock.click();
  await expect(page.getByRole("heading", { name: "来源" })).toBeVisible();
  await expect(page.getByText(/速记 · 面板搜索目标标题/)).toBeVisible();
});
