import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * 日 / 周时间网格全天行的跨天任务连续条：
 * 周视图一条横跨多列（不再每列复制同名 chip）、拖整条改期、日视图延续端开合 + 范围 aria-label。
 * 固定时钟 2026-10-21（周三）：周为 10/19（一）~ 10/25（日）。
 */

async function openCalendar(page: Page, width = 1440) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", "light");
  });
  await page.goto("/tasks/calendar");
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
}

const TITLE = "跨天出差";

test("周视图全天行连续条：单节点跨列、拖动改期、日视图延续端", async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 21, 12));
  await openCalendar(page);

  // n 快速新建：今天（10/21）起、结束 10/23 的跨天定时任务（取消「全天」以保留结束日期）→ 覆盖 10/21~10/23
  await page.keyboard.press("n");
  const card = page.locator("[data-calendar-quick-create]");
  await card.getByRole("textbox", { name: "标题" }).fill(TITLE);
  await card.getByRole("button", { name: "修改日期和时间" }).click();
  const editor = page.getByRole("dialog").filter({ has: page.getByLabel("开始日期", { exact: true }) });
  await editor.getByRole("button", { name: "时间段" }).click();
  await editor.getByLabel("结束日期", { exact: true }).fill("2026-10-23");
  await editor.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByLabel("开始日期", { exact: true })).toHaveCount(0);
  await card.getByRole("checkbox", { name: "全天" }).uncheck();
  await card.getByRole("textbox", { name: "标题" }).press("Enter");
  await expect(card).toHaveCount(0);
  await expect(page.locator('[data-calendar-surface="month"] [data-calendar-created="true"]')).toContainText(TITLE);

  // 周视图：跨三天任务只有一条连续条（周三~周五 = 第 2~4 列），不再每列复制
  await page.getByRole("button", { name: "周", exact: true }).click();
  const bar = page.locator('[data-countdown-surface="all-day"] [data-calendar-task-id]', { hasText: TITLE });
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveAttribute("data-all-day-span", "2-4");
  await expect(bar.locator("[data-calendar-task-checkbox]")).toHaveCount(1);

  // 从条中段抓起拖到周二列：整条平移到 10/20~10/22（第 1~3 列）
  const box = (await bar.boundingBox())!;
  const colWidth = box.width / 3; // 条恰好横跨 3 列
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - colWidth / 2, box.y + box.height / 2, { steps: 6 });
  await expect(page.locator('[data-drop-placeholder="all-day"]')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('[data-drop-placeholder="all-day"]')).toHaveCount(0);
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveAttribute("data-all-day-span", "1-3");

  // 日视图（今天 10/21 落在区间中段）：全宽条两端开合 + ‹ › 延续提示 + 日期范围 aria-label
  await page.getByRole("button", { name: "日", exact: true }).click();
  await page.locator('button[title="今天（t）"]').click();
  const dayBar: Locator = page.locator('[data-countdown-surface="all-day"] [data-calendar-task-id]', { hasText: TITLE });
  await expect(dayBar).toHaveCount(1);
  await expect(dayBar).toHaveAttribute("data-all-day-span", "0-0");
  await expect(dayBar).toHaveAttribute("aria-label", `${TITLE}，10月20日–10月22日`);
  await expect(dayBar).toContainText("‹");
  await expect(dayBar).toContainText("›");

  // 轻点条打开 peek（拖拽不吞点击）
  await dayBar.click();
  await expect(page).toHaveURL(/task=/);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/task=/);
});
