import { expect, test, type Page } from "@playwright/test";

const card = (page: Page) => page.locator("[data-calendar-quick-create]");

async function openCalendar(page: Page, theme: string, width = 1440) {
  await page.clock.setFixedTime(new Date(2026, 9, 21, 12));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await page.addInitScript((mode) => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", mode);
  }, theme);
  await page.goto("/tasks/calendar");
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
}

async function chooseRange(page: Page) {
  await card(page).getByRole("checkbox", { name: "全天", exact: true }).check();
  await card(page).getByRole("button", { name: "修改日期和时间" }).click();
  const editor = page.getByRole("dialog").filter({ has: page.getByLabel("开始日期", { exact: true }) });
  await expect(editor.getByRole("button", { name: "时间段", exact: true })).toBeInViewport();
  await editor.getByRole("button", { name: "时间段", exact: true }).click();
  await editor.getByLabel("结束日期", { exact: true }).fill("2026-10-23");
  await editor.getByRole("button", { name: "确定", exact: true }).click();
  await expect(card(page).getByRole("button", { name: "修改日期和时间" })).toHaveText("10月21日 – 10月23日 全天");
  await expect(card(page).getByRole("checkbox", { name: "全天", exact: true })).toBeChecked();
}

for (const theme of ["light", "dark"]) {
  test(`跨天全天快速新建：月/周/日预览、取消及连续条 ${theme}`, async ({ page }, info) => {
    await openCalendar(page, theme);
    for (const mode of ["月", "日", "周"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await page.keyboard.press("n");
      await card(page).getByRole("textbox", { name: "标题" }).fill("出差");
      await chooseRange(page);
      const preview = page.locator(`[data-calendar-create-preview="${mode === "月" ? "month" : "all-day"}"]:visible`);
      await expect(preview).toHaveCount(mode === "日" ? 1 : 3);
      await card(page).getByRole("textbox", { name: "标题" }).fill("跨天全天出差");
      for (const ghost of await preview.all()) await expect(ghost).toContainText("跨天全天出差");
      await page.screenshot({ path: info.outputPath(`multiday-preview-${mode}-${theme}.png`) });
      if (mode === "周") {
        await card(page).getByRole("textbox", { name: "标题" }).press("Enter");
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(card(page)).toHaveCount(0);
      await expect(page.locator("[data-calendar-create-preview]")).toHaveCount(0);
    }
    const bar = page.locator('[data-countdown-surface="all-day"] [data-calendar-task-id]', { hasText: "跨天全天出差" });
    await expect(bar).toHaveCount(1);
    await expect(bar).toHaveAttribute("data-all-day-span", "2-4");
    await expect(bar).toHaveAttribute("aria-label", "跨天全天出差，10月21日–10月23日");
    await page.screenshot({ path: info.outputPath(`multiday-saved-week-${theme}.png`) });
    await page.getByRole("button", { name: "月", exact: true }).click();
    const monthBar = page.locator('[data-calendar-surface="month"] [data-calendar-task-id]', { hasText: "跨天全天出差" });
    await expect(monthBar).toContainText("跨天全天出差");
    // 月条横跨三列，不再退化为起点的单日任务。
    const box = (await monthBar.boundingBox())!;
    const cell = (await page.getByRole("gridcell", { name: "10月21日", exact: true }).boundingBox())!;
    expect(box.width).toBeGreaterThan(cell.width * 2.5);
    await page.screenshot({ path: info.outputPath(`multiday-saved-month-${theme}.png`) });
  });

  test(`手机全天区间：空日期也有预览，取消移除临时分组 ${theme}`, async ({ page }, info) => {
    await openCalendar(page, theme, 390);
    await page.getByRole("button", { name: "添加待办", exact: true }).click();
    await card(page).getByRole("textbox", { name: "标题" }).fill("手机跨天出差");
    await chooseRange(page);
    const agenda = page.locator('[data-calendar-surface="mobile-month"]');
    for (const day of [21, 22, 23]) {
      await expect(agenda.locator(`[data-agenda-day="2026-9-${day}"] [role="status"]`)).toHaveText("手机跨天出差");
    }
    await page.screenshot({ path: info.outputPath(`multiday-mobile-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await expect(agenda.locator('[role="status"]')).toHaveCount(0);
  });
}
