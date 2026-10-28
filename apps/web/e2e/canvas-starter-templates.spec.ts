import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 空白画布「快速开始」起步模板（mock 后端）：
 * 新建画布 → 见面板 → 选模板一次插入且面板消失 → ⌘Z 一步回空白面板重现 → Esc 关闭本会话不再显示；
 * 预览 / 手机宽度不显示；明暗主题可见。
 */

async function openCanvas(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
}

async function expectInsideViewport(page: Page, items: Locator) {
  const viewport = (await page.getByTestId("canvas-viewport").boundingBox())!;
  const count = await items.count();
  for (let i = 0; i < count; i += 1) {
    const box = (await items.nth(i).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(viewport.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(viewport.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
  }
}

test("空白画布显示快速开始；选头脑风暴一次插入并适合视口，⌘Z 一步回到空白面板重现，内容写入保存", async ({ page }) => {
  await openCanvas(page);
  const panel = page.getByTestId("canvas-starter-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAccessibleName("快速开始");
  await expect(panel.getByRole("button")).toHaveCount(6);
  await expect(panel.getByRole("button", { name: /空白画布/ })).toBeVisible();

  await panel.getByRole("button", { name: /头脑风暴/ }).click();
  const items = page.locator("[data-free-item-id]");
  await expect(items).toHaveCount(7);
  await expect(panel).toHaveCount(0);
  await expect(items.first()).toContainText("中心主题");
  await expectInsideViewport(page, items);

  await page.keyboard.press("Meta+z");
  await expect(items).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Meta+Shift+z");
  await expect(items).toHaveCount(7);
  await expect(panel).toHaveCount(0);

  await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
  const id = page.url().split("/").pop()!;
  const saved = await page.evaluate(async (id) => (await fetch(`/api/canvases/${id}`)).json(), id);
  expect(saved.content.schemaVersion).toBe(2);
  expect(saved.content.boards).toHaveLength(0);
  expect(saved.content.freeItems).toHaveLength(7);
});

test("键盘：方向键移动、Enter 选流程图插入节点与连接线；Esc 关闭后本会话不再显示", async ({ page }) => {
  await openCanvas(page);
  const panel = page.getByTestId("canvas-starter-panel");
  const first = panel.getByRole("button").first();
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(panel.getByRole("button", { name: /流程图/ })).toBeFocused();
  await page.keyboard.press("Enter");
  const items = page.locator("[data-free-item-id]");
  await expect(items).toHaveCount(4);
  await expect(page.locator("[data-connector-id]")).toHaveCount(3);
  await expect(panel).toHaveCount(0);
  await expectInsideViewport(page, items);

  // 回到空白后面板重现，再用 Esc 关闭：空白画布只剩双击提示
  await page.keyboard.press("Meta+z");
  await expect(items).toHaveCount(0);
  await expect(panel).toBeVisible();
  await panel.getByRole("button").first().focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("双击画布任意位置，开始你的第一张构思稿")).toBeVisible();

  // 本次会话内再回到空白也不再显示
  await page.getByRole("button", { name: "新建空白页面" }).click();
  await expect(page.locator("[data-board-id]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+z");
  await expect(page.locator("[data-board-id]")).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("双击画布任意位置，开始你的第一张构思稿")).toBeVisible();
});

test("看板模板插入一页三列并选中整页；空白画布选项关闭面板不改文档", async ({ page }) => {
  await openCanvas(page);
  const panel = page.getByTestId("canvas-starter-panel");
  await panel.getByRole("button", { name: /看板/ }).click();
  const board = page.locator("[data-board-id]");
  await expect(board).toHaveCount(1);
  await expect(board).toHaveClass(/is-selected/);
  for (const title of ["待办", "进行中", "完成"]) {
    await expect(board.getByText(title, { exact: true })).toHaveCount(1);
  }
  await expect(board.locator("[data-block-id]")).toHaveCount(9);
  await expect(panel).toHaveCount(0);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+z");
  await expect(board).toHaveCount(0);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: /空白画布/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(board).toHaveCount(0);
  await expect(page.locator("[data-free-item-id]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "撤销" })).toBeDisabled();
});

test("预览模式与手机宽度不显示面板；退出预览后恢复", async ({ page }) => {
  await openCanvas(page);
  const panel = page.getByTestId("canvas-starter-panel");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("预览模式 · 按 Esc 退出")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("note")).toContainText("手机端");
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(panel).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}：面板与选项可见、可读，SWOT 模板四象限落在页面内`, async ({ page }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("organize-theme", theme), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCanvas(page);
    const panel = page.getByTestId("canvas-starter-panel");
    await expect(panel).toBeVisible();
    const option = panel.getByRole("button", { name: /SWOT/ });
    await expect(option).toBeVisible();
    const color = await option.evaluate((el) => getComputedStyle(el).color);
    const background = await option.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(color).not.toBe(background);
    await page.screenshot({ path: testInfo.outputPath(`starter-${theme}.png`) });
    await option.click();
    const board = page.locator("[data-board-id]");
    await expect(board).toHaveCount(1);
    await expect(board.locator("[data-block-id]")).toHaveCount(8);
    await expect(panel).toHaveCount(0);
  });
}
