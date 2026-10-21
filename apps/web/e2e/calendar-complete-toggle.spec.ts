import { expect, test, type Page } from "@playwright/test";

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

async function createMonthTask(page: Page, title: string) {
  const cell = page.getByRole("gridcell").last();
  await cell.click({ position: { x: 60, y: 45 } });
  const input = page.locator('[data-calendar-quick-create]').getByRole("textbox", { name: "标题" });
  await input.fill(title);
  await input.press("Enter");
  await expect(page.locator('[data-calendar-quick-create]')).toHaveCount(0);
}

function monthHeader(page: Page) {
  return page.locator("[data-calendar-month-header] > div");
}

test("月视图就地勾选完成：不打开详情，toast 撤销可用", async ({ page }) => {
  await openCalendar(page);
  await createMonthTask(page, "就地完成验证");
  const bar = page.locator("button.absolute", { hasText: "就地完成验证" });
  await expect(bar).toBeVisible();
  const box = bar.locator("[data-calendar-task-checkbox]");
  await expect(box).toHaveAttribute("aria-checked", "false");
  await box.click();
  // 勾选立即变为已完成样式，并出现带撤销的 toast；不打开 peek / 不改 URL
  await expect(bar).toHaveClass(/line-through/);
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeVisible();
  await expect(page.locator(".organize-task-detail")).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(bar).not.toHaveClass(/line-through/);
  // 键盘 Space 也能切换
  await box.focus();
  await page.keyboard.press("Space");
  await expect(bar).toHaveClass(/line-through/);
});

test("显示选项：四项生效且刷新后保持", async ({ page }) => {
  await openCalendar(page);
  await createMonthTask(page, "隐藏完成验证");
  const bar = page.locator("button.absolute", { hasText: "隐藏完成验证" });
  await bar.locator("[data-calendar-task-checkbox]").click();
  await expect(bar).toHaveClass(/line-through/);

  const menu = page.getByRole("menu", { name: "日历显示选项" });
  await page.getByRole("button", { name: "日历显示选项" }).click();
  await expect(menu).toBeVisible();
  // 隐藏已完成：已完成的条立即从视图消失（toast 撤销仍可恢复）
  await menu.getByRole("menuitemcheckbox", { name: "显示已完成任务" }).click();
  await expect(bar).toHaveCount(0);
  // 恢复显示，任务回来
  await menu.getByRole("menuitemcheckbox", { name: "显示已完成任务" }).click();
  await expect(bar).toBeVisible();
  // 隐藏周末：月表头只剩 5 列工作日
  await menu.getByRole("menuitemcheckbox", { name: "显示周末" }).click();
  await expect(monthHeader(page)).toHaveCount(5);
  await expect(monthHeader(page).first()).toHaveText("周一");
  // 周起始日切周日：表头第一列为周日，今天格子仍在
  await menu.getByRole("menuitemradio", { name: "周日" }).click();
  await expect(monthHeader(page).first()).toHaveText("周日");
  const now = new Date();
  await expect(page.getByRole("gridcell", { name: `${now.getMonth() + 1}月${now.getDate()}日`, exact: true })).toBeVisible();
  // Esc 关闭菜单并还焦点；刷新后选项从 localStorage 恢复
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "日历显示选项" })).toBeFocused();
  await page.reload();
  await expect(monthHeader(page).first()).toHaveText("周日");
  await expect(monthHeader(page)).toHaveCount(5);
});

test("mobile 390：议程方框可点，显示菜单触控目标达标", async ({ page }) => {
  await openCalendar(page, 390);
  const surface = page.locator('[data-calendar-surface="mobile-month"]');
  await surface.getByRole("button", { name: /添加/ }).first().click();
  const input = page.locator('[data-calendar-quick-create]').getByRole("textbox", { name: "标题" });
  await input.fill("手机勾选验证");
  await input.press("Enter");
  const row = surface.locator("div.border-b", { hasText: "手机勾选验证" }).first();
  const box = row.locator("[data-calendar-task-checkbox]");
  await expect(box).toHaveAttribute("aria-checked", "false");
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "true");
  await expect(row.getByText("手机勾选验证")).toHaveClass(/line-through/);
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeVisible();
  await expect(page.locator(".organize-task-detail")).toHaveCount(0);
  // 显示菜单项触控目标 ≥ 40px
  await page.getByRole("button", { name: "日历显示选项" }).click();
  const menu = page.getByRole("menu", { name: "日历显示选项" });
  const item = menu.getByRole("menuitemcheckbox", { name: "显示倒数日" });
  await expect(item).toBeVisible();
  const itemRect = await item.boundingBox();
  expect(itemRect!.height).toBeGreaterThanOrEqual(40);
});
