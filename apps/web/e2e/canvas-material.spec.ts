import { expect, test, type Page } from "@playwright/test";
import { createBoardShape, CANVAS_SCHEMA_VERSION } from "../lib/canvas/model";

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
  // 「全部」主列表只放阅读物，速记卡片在「速记」标签
  await page.getByRole("tab", { name: "速记" }).click();
}

test("资料库「添加到画布」→ 新建画布 → 快照卡片可见（标题 + 来源行）", async ({ page }) => {
  await openPage(page, "/library");
  await saveMemo(page, "E2E 画布联动标题\n\n这段正文会被引用进画布。");

  await page.getByRole("button", { name: /把「E2E 画布联动标题」添加到画布/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "添加到画布", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("选择画布")).toHaveText("新建画布");
  await dialog.getByRole("button", { name: "添加" }).click();

  await expect(page.getByText("已添加到画布").first()).toBeVisible();
  const link = page.getByRole("link", { name: "打开画布查看 →" });
  await expect(link).toHaveAttribute("href", /\?focus=/);
  await link.click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();

  // 快照卡片：标题 + 摘录 + 来源行（速记徽标）
  const cardBlock = page.locator("[data-block-type='materialCard']");
  await expect(cardBlock).toBeVisible();
  await expect(cardBlock.locator(".canvas-material-card-title")).toHaveText("E2E 画布联动标题");
  await expect(cardBlock.getByText(/这段正文会被引用进画布。/)).toBeVisible();
  await expect(cardBlock.getByText("速记", { exact: true })).toBeVisible();
  await expect(page.getByLabel("卡片标题")).toHaveValue("E2E 画布联动标题");
  await expect(page).not.toHaveURL(/focus=/);
  const viewport = await page.getByTestId("canvas-viewport").boundingBox();
  const card = await cardBlock.boundingBox();
  expect(viewport).not.toBeNull(); expect(card).not.toBeNull();
  expect(card!.x).toBeGreaterThanOrEqual(viewport!.x);
  expect(card!.y).toBeGreaterThanOrEqual(viewport!.y);
  expect(card!.x + card!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width);
  expect(card!.y + card!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
});

test("快照独立性：画布改卡片标题，原速记不变（验收 22）", async ({ page }) => {
  await openPage(page, "/library");
  await saveMemo(page, "快照独立性标题\n\n原文内容保持不变。");

  await page.getByRole("button", { name: /把「快照独立性标题」添加到画布/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "添加到画布", exact: true });
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


test("添加目标可搜索、记住第二页区块、提示重复，手机宽度不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPage(page, "/library");
  const first = createBoardShape({ x: 80, y: 80 }); first.name = "第一页";
  const second = createBoardShape({ x: 9000, y: 8000 }); second.name = "第二页"; second.regions[0].name = "证据";
  const title = "研究项目：连续整理资料时应保留完整标题并在窄屏中正确截断";
  await page.evaluate(async ({ title, content }) => {
    for (let i = 0; i < 8; i++) {
      const response = await fetch("/api/canvases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        id: crypto.randomUUID(), title: i === 7 ? title : `其他项目 ${i}`, content,
      }) });
      if (!response.ok) throw new Error("seed canvas failed");
    }
  }, { title, content: { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [first, second], freeItems: [] } });
  await saveMemo(page, "连续整理目标资料\n\n验证记忆、搜索和重复提示。");
  const trigger = page.getByRole("button", { name: /把「连续整理目标资料」添加到画布/ }).first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "添加到画布", exact: true });
  await dialog.getByLabel("选择画布").click();
  const search = page.getByLabel("搜索画布");
  await search.fill("研究项目");
  await page.getByRole("option", { name: new RegExp(title) }).click();
  await dialog.getByLabel("选择页面").click();
  await page.getByRole("option", { name: "第二页", exact: true }).click();
  await dialog.getByLabel("选择区块").click();
  await page.getByRole("option", { name: "证据", exact: true }).click();
  await expect(dialog.getByText(/将添加到：.*第二页 › 证据 末尾/)).toBeVisible();
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await trigger.click();
  await expect(dialog.getByLabel("选择页面")).toHaveText("第二页");
  await expect(dialog.getByLabel("选择区块")).toHaveText("证据");
  await expect(dialog.getByText("此画布已有这条资料的卡片")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "添加", exact: true })).toBeEnabled();
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(page.locator('[role="status"][data-state]')).toHaveCount(0);
  if (process.env.CANVAS_FLOW_SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.CANVAS_FLOW_SCREENSHOTS_DIR}/dialog-1440.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("button", { name: "添加", exact: true })).toBeInViewport();
  await expect.poll(async () => {
    const box = await dialog.boundingBox();
    return !!box && box.x >= 0 && box.x + box.width <= 390;
  }).toBe(true);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await dialog.getByLabel("选择页面").click();
  await page.getByRole("option", { name: "第二页", exact: true }).click();
  await dialog.getByLabel("选择区块").click();
  await page.getByRole("option", { name: "证据", exact: true }).click();
  await dialog.getByLabel("选择画布").click();
  await expect(page.getByLabel("搜索画布")).toBeInViewport();
  await page.getByLabel("搜索画布").fill("不存在");
  await expect(page.getByText("没有匹配的画布")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible(); // Escape closes only the top picker.
  await expect(page.getByLabel("搜索画布")).not.toBeVisible();
  if (process.env.CANVAS_FLOW_SCREENSHOTS_DIR) await page.screenshot({ path: `${process.env.CANVAS_FLOW_SCREENSHOTS_DIR}/dialog-390.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await trigger.click();
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const link = page.getByRole("link", { name: "打开画布查看 →" }).first();
  const blockId = new URL((await link.getAttribute("href"))!, "http://localhost").searchParams.get("focus")!;
  await link.click();
  const focusedCard = page.locator(`[data-block-id="${blockId}"]`);
  await expect(focusedCard).toHaveClass(/is-selected/);
  await expect(focusedCard).toBeInViewport({ ratio: 1 });
  await expect(page).not.toHaveURL(/focus=/);
});
