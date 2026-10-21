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
  await expect(page.locator('.organize-calendar-screen .animate-spin')).toHaveCount(0);
}
const card = (page: Page) => page.locator('[data-calendar-quick-create]');

for (const theme of ["light", "dark"]) {
  test(`desktop month edge, focus and schedule editing ${theme}`, async ({ page }, info) => {
    await openCalendar(page, 1440, theme);
    const cell = page.getByRole("gridcell").last();
    await cell.click({ position: { x: 60, y: 45 } });
    await expect(card(page).getByRole("textbox", { name: "标题" })).toBeFocused();
    await card(page).getByRole("textbox", { name: "标题" }).fill("边缘格子新任务");
    await expect(page.locator('[data-calendar-create-preview="month"]')).toHaveText("边缘格子新任务");
    const rect = await card(page).boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(1440);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(900);
    await expect(page.locator('.organize-dialog-overlay')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`calendar-create-desktop-${theme}.png`) });
    await card(page).getByRole("button", { name: "修改日期和时间" }).click();
    const dates = page.getByRole("dialog").filter({ has: page.getByLabel("开始日期", { exact: true }) });
    await expect(dates).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("开始日期", { exact: true })).toHaveCount(0);
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByRole("textbox", { name: "标题" })).toHaveValue("边缘格子新任务");
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await expect(cell).toBeFocused();
    await expect(page.locator('[data-calendar-create-preview]')).toHaveCount(0);
  });

  test(`mobile bottom panel and nested date popover ${theme}`, async ({ page }, info) => {
    await openCalendar(page, 390, theme);
    await page.locator('[data-calendar-surface="mobile-month"]').getByRole("button", { name: /添加/ }).first().click();
    await expect(card(page).getByRole("textbox", { name: "标题" })).toBeFocused();
    await card(page).getByRole("textbox", { name: "标题" }).fill("手机新任务");
    await expect.poll(async () => (await page.locator('.organize-dialog-content').boundingBox())!.x).toBe(0);
    const rect = await page.locator('.organize-dialog-content').boundingBox();
    expect(rect!.x).toBe(0); expect(rect!.width).toBe(390);
    expect(rect!.y).toBeGreaterThan(150);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: info.outputPath(`calendar-create-mobile-${theme}.png`) });
    await card(page).getByRole("button", { name: "修改日期和时间" }).click();
    await expect(page.getByLabel("开始日期", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("开始日期", { exact: true })).toHaveCount(0);
    await expect(card(page)).toBeVisible();
    await card(page).getByRole("textbox", { name: "标题" }).press("Enter");
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('[data-calendar-surface="mobile-month"] [data-calendar-created="true"]').getByText("手机新任务", { exact: true })).toBeVisible();
  });
}

test("day and week drag a range, type title, Enter creates precisely there", async ({ page }) => {
  await openCalendar(page);
  for (const mode of ["日", "周"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    const surface = page.locator('[data-time-grid-day]:visible').last();
    await surface.evaluate((element) => { element.closest('.overflow-y-auto')!.scrollTop = 7 * 56; });
    const rect = await surface.boundingBox();
    const x = rect!.x + rect!.width / 2;
    const y = rect!.y + 9 * 56;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 84, { steps: 8 });
    await page.mouse.up();
    await expect(card(page)).toBeVisible();
    const title = `${mode}拖选任务`;
    await card(page).getByRole("textbox", { name: "标题" }).fill(title);
    await expect(surface.locator('[data-calendar-create-preview="timed"]')).toContainText("09:00 – 10:30");
    await expect(surface.locator('[data-calendar-create-preview="timed"]')).toContainText(title);
    await card(page).getByRole("textbox", { name: "标题" }).press("Enter");
    await expect(card(page)).toHaveCount(0);
    const created = surface.locator('[data-calendar-created="true"]');
    await expect(created).toContainText(title);
    await expect(created).toHaveCSS("top", "505px");
    await expect(created).toHaveCSS("height", "82px");
  }
});


test("N, more options and countdown keep their creation paths", async ({ page }) => {
  await openCalendar(page);
  await page.keyboard.press("n");
  await card(page).getByRole("textbox", { name: "标题" }).fill("继续补充详情");
  await card(page).getByRole("button", { name: "更多选项" }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page).toHaveURL(/task=/);
  await expect(page.locator(".organize-task-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/task=/);
  await page.keyboard.press("n");
  await card(page).getByRole("button", { name: "倒数日", exact: true }).click();
  await card(page).getByRole("textbox", { name: "标题" }).fill("发布倒数日");
  await card(page).getByRole("textbox", { name: "标题" }).press("Enter");
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('[data-calendar-created="true"]').getByRole("button", { name: "倒数日 · 发布倒数日" })).toBeVisible();
});


test("crowded month +N transfers to anchored creation without losing title focus", async ({ page }) => {
  await openCalendar(page);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("n");
    await card(page).getByRole("textbox", { name: "标题" }).fill(`填格任务${i}`);
    await card(page).getByRole("textbox", { name: "标题" }).press("Enter");
    await expect(card(page)).toHaveCount(0);
  }
  const today = await page.evaluate(() => `${new Date().getMonth() + 1}月${new Date().getDate()}日`);
  const more = page.getByRole("gridcell", { name: today, exact: true }).getByRole("button", { name: /查看.*全部/ });
  await more.click();
  const dayPopover = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "在日视图打开" }) });
  await dayPopover.getByRole("button", { name: "添加", exact: true }).click();
  await expect(card(page).getByRole("textbox", { name: "标题" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
});


test("15-minute selection keeps the live title visible without enlarging its range", async ({ page }) => {
  await openCalendar(page);
  await page.getByRole("button", { name: "日", exact: true }).click();
  const surface = page.locator('[data-time-grid-day]:visible');
  await surface.evaluate((element) => { element.closest('.overflow-y-auto')!.scrollTop = 7 * 56; });
  const rect = await surface.boundingBox();
  const x = rect!.x + rect!.width / 2;
  const y = rect!.y + 9 * 56;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + 14, { steps: 3 }); await page.mouse.up();
  await card(page).getByRole("textbox", { name: "标题" }).fill("短任务标题");
  const preview = surface.locator('[data-calendar-create-preview="timed"]');
  await expect(preview).toHaveCSS("height", "14px");
  await expect(preview.getByText("短任务标题", { exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
});
