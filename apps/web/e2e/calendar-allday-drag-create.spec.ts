import { expect, test, type Page } from "@playwright/test";

const card = (page: Page) => page.locator("[data-calendar-quick-create]");
const schedule = (page: Page) => card(page).getByRole("button", { name: "修改日期和时间" });

async function openCalendar(page: Page) {
  await page.clock.setFixedTime(new Date(2026, 9, 21, 12));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", "light");
  });
  await page.goto("/tasks/calendar");
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
}

/** 月格下半部（泳道与日期数字之下、倒数日条带之上）的空白坐标。 */
async function monthBlank(page: Page, label: string) {
  const box = (await page.getByRole("gridcell", { name: label, exact: true }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.8, width: box.width };
}

async function allDayBlank(page: Page, key: string) {
  const box = (await page.locator(`[data-countdown-surface="all-day"] [data-countdown-date="${key}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("月格拖过三天：区间高亮后打开跨天全天创建卡，保存为连续条；Esc 取消拖选不建卡", async ({ page }, info) => {
  await openCalendar(page);
  const from = await monthBlank(page, "10月27日");
  const to = await monthBlank(page, "10月29日");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await expect(page.locator('[data-calendar-drag-create="month"]')).toHaveCount(3);
  await expect(page.locator('[data-calendar-drag-create-bar="month"]')).toHaveText("10月27日 – 10月29日 全天");
  await page.screenshot({ path: info.outputPath("month-drag-selecting.png") });
  await page.mouse.up();
  await expect(card(page).getByRole("textbox", { name: "标题" })).toBeFocused();
  await expect(schedule(page)).toHaveText("10月27日 – 10月29日 全天");
  await expect(card(page).getByRole("checkbox", { name: "全天", exact: true })).toBeChecked();
  await expect(page.locator('[data-calendar-drag-create]')).toHaveCount(0);
  await expect(page.locator('[data-calendar-create-preview="month"]:visible')).toHaveCount(3);
  await card(page).getByRole("textbox", { name: "标题" }).fill("拖选出差");
  await page.screenshot({ path: info.outputPath("month-drag-card.png") });
  await card(page).getByRole("textbox", { name: "标题" }).press("Enter");
  await expect(card(page)).toHaveCount(0);
  const bar = page.locator('[data-calendar-surface="month"] [data-calendar-task-id]', { hasText: "拖选出差" });
  await expect(bar).toHaveCount(1);
  expect((await bar.boundingBox())!.width).toBeGreaterThan(from.width * 2.5);
  // 松手后的兼容 click 已被吞掉：只开过一张卡，也没有残留第二张。
  await expect(page.locator("[data-calendar-quick-create]")).toHaveCount(0);

  // 拖选过程中 Esc：清空高亮、不建卡；随后的轻点仍可建单日全天。
  const esc = await monthBlank(page, "10月30日");
  await page.mouse.move(esc.x, esc.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(page.locator('[data-calendar-drag-create="month"]')).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-calendar-drag-create="month"]')).toHaveCount(0);
  await page.mouse.up();
  await expect(card(page)).toHaveCount(0);
  await page.mouse.click(esc.x, esc.y);
  await expect(schedule(page)).toHaveText("10月30日 全天");
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
});

test("周视图全天行：轻点空白列建单日全天，拖过相邻列建跨天全天并保存为连续条", async ({ page }, info) => {
  await openCalendar(page);
  await page.getByRole("button", { name: "周", exact: true }).click();
  await expect(page.getByRole("heading", { name: "10月19日 - 25日", exact: true })).toBeVisible();

  // mock 种子里 10/23–10/25 有一条跨天任务占住全天行右侧泳道，这里只用左侧空白列。
  const single = await allDayBlank(page, "2026-10-19");
  await page.mouse.click(single.x, single.y);
  await expect(card(page).getByRole("textbox", { name: "标题" })).toBeFocused();
  await expect(schedule(page)).toHaveText("10月19日 全天");
  await expect(card(page).getByRole("checkbox", { name: "全天", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);

  const from = await allDayBlank(page, "2026-10-20");
  const to = await allDayBlank(page, "2026-10-22");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator('[data-calendar-drag-create="all-day"]')).toHaveCount(3);
  await expect(page.locator('[data-calendar-drag-create-bar="all-day"]')).toHaveText("10月20日 – 10月22日 全天");
  await page.screenshot({ path: info.outputPath("week-allday-drag-selecting.png") });
  await page.mouse.up();
  await expect(card(page).getByRole("textbox", { name: "标题" })).toBeFocused();
  await expect(schedule(page)).toHaveText("10月20日 – 10月22日 全天");
  await expect(page.locator('[data-calendar-drag-create]')).toHaveCount(0);
  await expect(page.locator('[data-calendar-create-preview="all-day"]:visible')).toHaveCount(3);
  await card(page).getByRole("textbox", { name: "标题" }).fill("周全天行拖选");
  await card(page).getByRole("textbox", { name: "标题" }).press("Enter");
  await expect(card(page)).toHaveCount(0);
  const bar = page.locator('[data-countdown-surface="all-day"] [data-calendar-task-id]', { hasText: "周全天行拖选" });
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveAttribute("data-all-day-span", "1-3");
  await expect(bar).toHaveAttribute("aria-label", "周全天行拖选，10月20日–10月22日");
  await page.screenshot({ path: info.outputPath("week-allday-drag-saved.png") });

  // 日视图：单列全天行轻点同样建当日全天（从月格日期数字进入一个全天行为空的日子）。
  await page.getByRole("button", { name: "月", exact: true }).click();
  await page.getByRole("button", { name: "打开 10月19日 日视图", exact: true }).click();
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveAttribute("aria-pressed", "true");
  const dayColumn = await allDayBlank(page, "2026-10-19");
  await page.mouse.click(dayColumn.x, dayColumn.y);
  await expect(schedule(page)).toHaveText("10月19日 全天");
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
});
