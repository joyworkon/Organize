import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 日历任务块的右键 / 长按 / 键盘菜单：
 * 月视图改期与删除撤销、键盘 Delete / Shift+F10、周视图清除日期、
 * 日视图标记完成、手机 390 长按（月议程行 + 周议程行）。
 */

async function openCalendar(page: Page, width = 1440, theme = "light") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await page.addInitScript((mode) => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", mode);
  }, theme);
  await page.goto("/tasks/calendar");
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
}

// n 热键在今天的活动格上打开快速新建；输入标题回车即创建全天任务
async function createTodayTask(page: Page, title: string) {
  await page.keyboard.press("n");
  const input = page.locator('[data-calendar-quick-create]').getByRole("textbox", { name: "标题" });
  await input.fill(title);
  await input.press("Enter");
  await expect(page.locator('[data-calendar-quick-create]')).toHaveCount(0);
}

async function openTaskMenu(page: Page, target: Locator) {
  await target.click({ button: "right" });
  const menu = page.locator('[data-testid="calendar-task-menu"]');
  await expect(menu).toBeVisible();
  return menu;
}

const undoButton = (page: Page) => page.getByRole("button", { name: "撤销", exact: true }).last();
const cellName = (page: Page, offsetDays: number) =>
  page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }, offsetDays);

// 月视图任务条绝对定位于周行内，DOM 上不是格子的子元素；用包围盒几何包含断言位置
async function expectInside(bar: Locator, cell: Locator) {
  const barBox = await bar.boundingBox();
  const cellBox = await cell.boundingBox();
  expect(barBox).not.toBeNull();
  expect(cellBox).not.toBeNull();
  expect(barBox!.x).toBeGreaterThanOrEqual(cellBox!.x - 1);
  expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(cellBox!.x + cellBox!.width + 1);
  expect(barBox!.y).toBeGreaterThanOrEqual(cellBox!.y - 1);
  expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(cellBox!.y + cellBox!.height + 1);
}

async function expectOutside(bar: Locator, cell: Locator) {
  const barBox = await bar.boundingBox();
  const cellBox = await cell.boundingBox();
  if (!barBox || !cellBox) return;
  const separated =
    barBox.x + barBox.width < cellBox.x || barBox.x > cellBox.x + cellBox.width ||
    barBox.y + barBox.height < cellBox.y || barBox.y > cellBox.y + cellBox.height;
  expect(separated).toBe(true);
}
test("月视图右键菜单：改期到明天，撤销恢复", async ({ page }) => {
  await openCalendar(page);
  await createTodayTask(page, "右键改期验证");
  const bar = page.locator("button.absolute", { hasText: "右键改期验证" });
  await expect(bar).toBeVisible();
  const menu = await openTaskMenu(page, bar);
  for (const label of ["打开详情", "标记完成", "今天", "明天", "下周一", "清除日期", "复制一份", "删除"]) {
    await expect(menu).toContainText(label);
  }
  await page.locator('[data-testid="calendar-task-menu-tomorrow"]').click();
  // 条目离开今天、出现在明天的格子；toast 提供撤销
  const todayCell = page.getByRole("gridcell", { name: await cellName(page, 0), exact: true });
  const tomorrowCell = page.getByRole("gridcell", { name: await cellName(page, 1), exact: true });
  await expect(bar).toHaveCount(1);
  await expect(page.getByText("已改期到明天")).toBeVisible();
  await expectInside(bar, tomorrowCell);
  await expectOutside(bar, todayCell);
  await undoButton(page).click();
  await expectInside(bar, todayCell);
  await expectOutside(bar, tomorrowCell);
});

test("月视图右键删除进垃圾箱，撤销恢复", async ({ page }) => {
  await openCalendar(page);
  await createTodayTask(page, "右键删除验证");
  const bar = page.locator("button.absolute", { hasText: "右键删除验证" });
  await openTaskMenu(page, bar);
  await page.locator('[data-testid="calendar-task-menu-delete"]').click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByText("任务已移入垃圾箱")).toBeVisible();
  await undoButton(page).click();
  await expect(page.getByText("已恢复任务")).toBeVisible();
  await expect(bar).toBeVisible();
});

test("键盘：Delete 删除撤销，Shift+F10 打开菜单后方向键 + Enter 完成", async ({ page }) => {
  await openCalendar(page);
  await createTodayTask(page, "键盘删除验证");
  const bar = page.locator("button.absolute", { hasText: "键盘删除验证" });
  await expect(bar).toBeVisible();
  await bar.focus();
  await page.keyboard.press("Delete");
  await expect(bar).toHaveCount(0);
  await expect(page.getByText("任务已移入垃圾箱")).toBeVisible();
  await undoButton(page).click();
  await expect(bar).toBeVisible();
  // Shift+F10 打开菜单并聚焦第一项；↓ 到「标记完成」，Enter 激活
  await bar.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.locator('[data-testid="calendar-task-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="calendar-task-menu-open"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(bar).toHaveClass(/line-through/);
  await expect(undoButton(page)).toBeVisible();
});

test("周/日视图：右键清除日期可撤销，日视图菜单标记完成", async ({ page }) => {
  await openCalendar(page);
  await createTodayTask(page, "周视图清除验证");
  await page.getByRole("button", { name: "周", exact: true }).click();
  await page.locator('button[title="今天（t）"]').click();
  const chip = page.locator('button[data-calendar-task-id]', { hasText: "周视图清除验证" }).first();
  await expect(chip).toBeVisible();
  await openTaskMenu(page, chip);
  await page.locator('[data-testid="calendar-task-menu-clear"]').click();
  await expect(chip).toHaveCount(0);
  await expect(page.getByText("已从日历移除")).toBeVisible();
  await undoButton(page).click();
  await expect(chip).toBeVisible();
  // 日视图：同一菜单里标记完成，勾选状态翻转
  await page.getByRole("button", { name: "日", exact: true }).click();
  const dayChip = page.locator('button[data-calendar-task-id]', { hasText: "周视图清除验证" }).first();
  await expect(dayChip).toBeVisible();
  await expect(dayChip.locator("[data-calendar-task-checkbox]")).toHaveAttribute("aria-checked", "false");
  await openTaskMenu(page, dayChip);
  await page.locator('[data-testid="calendar-task-menu-toggle"]').click();
  await expect(dayChip.locator("[data-calendar-task-checkbox]")).toHaveAttribute("aria-checked", "true");
  await expect(undoButton(page)).toBeVisible();
});

test.describe("mobile 390 长按", () => {
  test.use({ hasTouch: true });

  test("月议程行长按改期；周议程行长按完成", async ({ page }) => {
    await openCalendar(page, 390);
    const surface = page.locator('[data-calendar-surface="mobile-month"]');
    await surface.getByRole("button", { name: /添加/ }).first().click();
    const input = page.locator('[data-calendar-quick-create]').getByRole("textbox", { name: "标题" });
    await input.fill("手机长按验证");
    await input.press("Enter");
    const menu = page.locator('[data-testid="calendar-task-menu"]');
    const row = surface.locator("div.border-b", { hasText: "手机长按验证" }).first();
    await expect(row).toBeVisible();

    // 长按月议程行 ≥500ms 打开菜单；抬指后菜单仍在、详情未打开
    const box = (await row.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 60, y: box.y + box.height / 2 }] });
    await expect(menu).toBeVisible({ timeout: 4000 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(menu).toBeVisible();
    await expect(page.locator(".organize-task-detail")).toHaveCount(0);
    await page.locator('[data-testid="calendar-task-menu-tomorrow"]').tap();
    await expect(page.getByText("已改期到明天")).toBeVisible();
    await undoButton(page).tap();
    await expect(row).toBeVisible();

    // 再长按一次改到今天：周模式议程按选中日展示，任务需落在今天
    const again = (await row.boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: again.x + 60, y: again.y + again.height / 2 }] });
    await expect(menu).toBeVisible({ timeout: 4000 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.locator('[data-testid="calendar-task-menu-today"]').tap();
    await expect(page.getByText("已改期到今天")).toBeVisible();

    // 周模式的手机议程行同样可长按，菜单里标记完成
    await page.locator('button[title="今天（t）"]').click();
    await page.getByRole("button", { name: "周", exact: true }).click();
    const weekRow = page.locator('[data-calendar-surface="mobile-week"] div[data-calendar-task-id]', { hasText: "手机长按验证" }).first();
    await expect(weekRow).toBeVisible();
    const weekBox = (await weekRow.boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: weekBox.x + 60, y: weekBox.y + weekBox.height / 2 }] });
    await expect(menu).toBeVisible({ timeout: 4000 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.locator('[data-testid="calendar-task-menu-toggle"]').tap();
    await expect(weekRow.locator("div.truncate")).toHaveClass(/line-through/);
  });
});
