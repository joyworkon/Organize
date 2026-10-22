import { expect, test, type Page } from "@playwright/test";

async function createTimedTask(page: Page, title: string) {
  await page.keyboard.press("n");
  const card = page.locator("[data-calendar-quick-create]");
  await card.getByRole("textbox", { name: "标题" }).fill(title);
  await card.getByRole("checkbox", { name: "全天", exact: true }).uncheck();
  await card.getByRole("button", { name: "修改日期和时间" }).click();
  const editor = page.getByRole("dialog").filter({ has: page.getByLabel("开始日期", { exact: true }) });
  await editor.getByRole("button", { name: "时间段", exact: true }).click();
  await editor.getByLabel("开始时间", { exact: true }).fill("09:00");
  await editor.getByLabel("结束时间", { exact: true }).fill("10:00");
  await editor.getByRole("button", { name: "确定", exact: true }).click();
  await card.getByRole("textbox", { name: "标题" }).press("Enter");
  await expect(card).toHaveCount(0);
  const id = await page.locator('[data-calendar-surface="month"] [data-calendar-created="true"]').getAttribute("data-calendar-task-id");
  expect(id).toBeTruthy();
  // 等待关闭焦点回到月格，确保下一次 n 热键不被输入框拦截。
  await expect(page.getByRole("gridcell", { name: "10月21日", exact: true })).toBeFocused();
  return id!;
}

for (const theme of ["light", "dark"]) {
  test(`日/周：重叠任务三块 +1，弹层勾选、菜单和打开隐藏任务 ${theme}`, async ({ page }, info) => {
    await page.clock.setFixedTime(new Date(2026, 9, 21, 12));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((mode) => {
      localStorage.setItem("organize:onboarded", "1");
      localStorage.setItem("organize-theme", mode);
    }, theme);
    await page.goto("/tasks/calendar");
    await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
    const createdIds: string[] = [];
    for (let i = 1; i <= 4; i++) createdIds.push(await createTimedTask(page, `重叠会议${i}`));

    for (const mode of ["周", "日"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      const column = page.locator("[data-time-grid-day]").filter({ has: page.locator("[data-timed-overlap-more]") });
      const more = column.locator("[data-timed-overlap-more]");
      await expect(more).toHaveText("+1");
      const blocks = column.locator("button[data-calendar-task-id]").filter({ hasText: "重叠会议" });
      await expect(blocks).toHaveCount(3);
      await expect(page.locator('[data-calendar-created="true"]')).toHaveCount(0);
      const visibleIds = await blocks.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-calendar-task-id")));
      const hiddenId = createdIds.find((id) => !visibleIds.includes(id));
      expect(hiddenId).toBeTruthy();
      await more.click();
      const popover = page.getByRole("dialog").filter({ hasText: "09:00 – 10:00" });
      await expect(popover.locator("[data-calendar-task-id]")).toHaveCount(4);
      for (let i = 1; i <= 4; i++) await expect(popover).toContainText(`重叠会议${i}`);
      await expect(popover).toHaveCSS("opacity", "1");
      await page.screenshot({ path: info.outputPath(`timed-overlap-${mode}-${theme}.png`) });
      const hidden = popover.locator(`[data-calendar-task-id="${hiddenId}"]`);
      const wasDone = await hidden.getByRole("checkbox").getAttribute("aria-checked");
      await hidden.getByRole("checkbox").click();
      await expect(hidden.getByRole("checkbox")).toHaveAttribute("aria-checked", wasDone === "true" ? "false" : "true");
      await expect(popover).toBeVisible();
      await hidden.click({ button: "right" });
      await expect(page.getByTestId("calendar-task-menu")).toBeVisible();
      await expect(page.getByTestId("calendar-task-menu-open")).toBeVisible();
      // 通过任务菜单打开隐藏项：popover 保持交互，复用原 peek。
      await page.getByTestId("calendar-task-menu-open").click();
      await expect(page).toHaveURL(new RegExp(`task=${hiddenId}`));
      await expect(page.locator(".organize-task-detail")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page).not.toHaveURL(/task=/);
      if (await popover.count()) await page.keyboard.press("Escape");
      await more.click();
      await popover.locator(`[data-calendar-task-id="${createdIds[3]}"]`).click();
      await expect(page).toHaveURL(new RegExp(`task=${createdIds[3]}`));
      await page.keyboard.press("Escape");
      await expect(page).not.toHaveURL(/task=/);
    }
  });
}
