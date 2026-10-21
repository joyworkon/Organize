import { expect, test, type Page } from "@playwright/test";

async function openCanvas(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
}

async function createBlankBoard(page: Page) {
  await page.getByRole("button", { name: "新建空白页面", exact: true }).click();
  await expect(page.locator("[data-block-id] textarea")).toBeFocused();
  await page.keyboard.press("Escape");
}

/** 经大纲把第一页改名后复制，得到两页文档。 */
async function duplicateFirstBoard(page: Page, name: string) {
  await page.getByRole("button", { name: "结构", exact: true }).click();
  const outline = page.locator(".canvas-outline-row.is-board");
  await outline.getByRole("button", { name: "重命名页面 页面 1", exact: true }).click();
  const nameBox = page.getByRole("textbox", { name: "页面名称", exact: true });
  await nameBox.fill(name);
  await nameBox.press("Enter");
  await outline.getByRole("button", { name: `复制页面 ${name}`, exact: true }).click();
  await expect(page.locator(".canvas-board")).toHaveCount(2);
  await page.keyboard.press("Escape");
}

/** 断言当前选中页面完整落在视口内（预览「适合当前页」的用户可感知结果）。 */
async function expectSelectedBoardInViewport(page: Page) {
  const shell = (await page.getByTestId("canvas-shell").boundingBox())!;
  const board = (await page.locator(".canvas-board.is-selected").boundingBox())!;
  expect(board).not.toBeNull();
  expect(board.x).toBeGreaterThanOrEqual(shell.x - 1);
  expect(board.y).toBeGreaterThanOrEqual(shell.y - 1);
  expect(board.x + board.width).toBeLessThanOrEqual(shell.x + shell.width + 1);
  expect(board.y + board.height).toBeLessThanOrEqual(shell.y + shell.height + 1);
}

async function viewport(page: Page) {
  return page.locator(".canvas-world").evaluate((el) => {
    const matrix = new DOMMatrix(getComputedStyle(el).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

test("进入预览适合当前页，方向键/Space 循环翻页并联动指示条", async ({ page }) => {
  await openCanvas(page);
  await createBlankBoard(page);
  await duplicateFirstBoard(page, "页面方案");

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const pager = page.getByTestId("canvas-preview-pager");
  await expect(pager).toBeVisible();
  await expect(pager).toContainText("第 1 / 2 页");
  await expect(pager).toContainText("页面方案");
  await expect(page.locator(".canvas-board.is-selected")).toHaveCount(1);
  await expectSelectedBoardInViewport(page);

  // → 下一页：页码、选中页、适合视口
  await page.keyboard.press("ArrowRight");
  await expect(pager).toContainText("第 2 / 2 页");
  await expectSelectedBoardInViewport(page);
  // 末页再 → 循环回首页
  await page.keyboard.press("ArrowRight");
  await expect(pager).toContainText("第 1 / 2 页");
  // 首页 ← 循环回末页
  await page.keyboard.press("ArrowLeft");
  await expect(pager).toContainText("第 2 / 2 页");
  // Space / Shift+Space / PageDown / PageUp 同一循环
  await page.keyboard.press("Space");
  await expect(pager).toContainText("第 1 / 2 页");
  await page.keyboard.press("Shift+Space");
  await expect(pager).toContainText("第 2 / 2 页");
  await page.keyboard.press("PageDown");
  await expect(pager).toContainText("第 1 / 2 页");
  await page.keyboard.press("PageUp");
  await expect(pager).toContainText("第 2 / 2 页");

  // 指示条按钮翻页
  await pager.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(pager).toContainText("第 1 / 2 页");
  await pager.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(pager).toContainText("第 2 / 2 页");

  // Esc 退出预览后可继续编辑
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "退出预览", exact: true })).toBeHidden();
  await expect(pager).toBeHidden();
  await expect(page.locator(".canvas-add-panel-wrap")).toBeVisible();
  await page.getByRole("button", { name: "添加正文", exact: true }).click();
  await expect(page.locator("[data-block-id]")).toHaveCount(3);
});

test("选中模块进预览落到所属页面，退出不改视口", async ({ page }) => {
  await openCanvas(page);
  await createBlankBoard(page);
  await duplicateFirstBoard(page, "第一页");

  // 点第二页标题模块：单击即选中（不进编辑态），进预览应落第二页
  await page.locator(".canvas-board").nth(1).locator("[data-block-id]").first().click();
  await expect(page.locator("[data-block-id].is-selected")).toHaveCount(1);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const pager = page.getByTestId("canvas-preview-pager");
  await expect(pager).toContainText("第 2 / 2 页");
  await expectSelectedBoardInViewport(page);

  // 退出预览不改视口缩放（保持退出时的位置）
  const beforeExit = await viewport(page);
  await page.keyboard.press("Escape");
  await expect(pager).toBeHidden();
  expect(await viewport(page)).toEqual(beforeExit);
});

test("无页面画布预览保持原提示，翻页不报错", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByTestId("canvas-preview-pager")).toBeHidden();
  await expect(page.locator(".canvas-preview-hint")).toContainText("预览模式 · 按 Esc 退出");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.locator(".canvas-preview-hint")).toContainText("预览模式 · 按 Esc 退出");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "预览", exact: true })).toBeVisible();
});
