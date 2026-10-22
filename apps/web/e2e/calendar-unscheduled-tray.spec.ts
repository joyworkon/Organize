import { expect, test, type Page } from "@playwright/test";

/**
 * 未排期任务托盘：从仪表盘「快速记录」建无日期待办，再经 SPA 导航进日历
 * （mockDb 在浏览器内存里，page.goto 整页刷新会丢数据，全程只能点链接走客户端路由）。
 */

async function createUnscheduledTask(page: Page, title: string) {
  await page.goto("/");
  const capture = page.getByRole("textbox", { name: "快速记录", exact: true });
  await expect(capture).toBeVisible();
  await capture.fill(`待办：${title}`);
  await page.getByRole("button", { name: "保存为待办", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function openCalendar(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 9, 21, 12));
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", "light");
  });
  await createUnscheduledTask(page, "托盘排期验证");
  await page.getByRole("link", { name: "全部待办", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\?scope=all$/);
  await page.getByRole("tab", { name: "日历", exact: true }).click();
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
}

async function openTray(page: Page) {
  await page.getByRole("button", { name: "未排期任务", exact: true }).click();
  const tray = page.locator("[data-calendar-unscheduled-tray]");
  await expect(tray).toBeVisible();
  return tray;
}

/** 从托盘拖任务到目标点；松手前先等落点预览出现（保证最后一次落点已上报页面）。 */
async function dragTrayRow(page: Page, title: string, to: { x: number; y: number }) {
  const row = page.locator(`[data-unscheduled-task-id]:has-text("${title}")`);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

test("托盘拖入月格：任务排到该日全天并从托盘消失；Esc 中途取消不改数据", async ({ page }) => {
  await openCalendar(page);
  const tray = await openTray(page);
  const title = "托盘排期验证";
  await expect(tray.getByText(title, { exact: true })).toBeVisible();

  // 拖到 10月27日 月格：出现同风格落点幽灵条，松手后排成全天任务
  const cell = await page.getByRole("gridcell", { name: "10月27日", exact: true }).boundingBox();
  await dragTrayRow(page, title, { x: cell!.x + cell!.width / 2, y: cell!.y + cell!.height * 0.6 });
  await expect(page.locator('[data-drop-placeholder-source="tray"]')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText("已排到 10月27日", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeVisible();
  const bar = page.locator('[data-calendar-surface="month"] [data-calendar-task-id]', { hasText: title });
  await expect(bar).toHaveCount(1);
  await expect(tray.getByText(title, { exact: true })).toHaveCount(0);

  // 撤销：任务回到托盘、月格条消失
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(tray.getByText(title, { exact: true })).toBeVisible();

  // 拖到 10月28日 途中按 Esc：预览消失、松手不落盘、托盘里还在
  const escCell = await page.getByRole("gridcell", { name: "10月28日", exact: true }).boundingBox();
  await dragTrayRow(page, title, { x: escCell!.x + escCell!.width / 2, y: escCell!.y + escCell!.height * 0.6 });
  await expect(page.locator('[data-drop-placeholder-source="tray"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-drop-placeholder-source="tray"]')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByText("已排到 10月28日", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-calendar-surface="month"] [data-calendar-task-id]', { hasText: title })).toHaveCount(0);
  await expect(tray.getByText(title, { exact: true })).toBeVisible();
});

test("托盘拖入周视图时间格：排成 14:00 定时任务，撤销后恢复未排期", async ({ page }) => {
  await openCalendar(page);
  await page.getByRole("button", { name: "周", exact: true }).click();
  await expect(page.getByRole("heading", { name: "10月19日 - 25日", exact: true })).toBeVisible();
  const tray = await openTray(page);
  const title = "托盘排期验证";

  // 时间网格先滚到 07:00，再把任务拖到 10月22日 列的 14:00 槽位（日期键月份 0 起）
  const column = page.locator('[data-time-grid-day="2026-9-22"]');
  await column.evaluate((element) => {
    element.closest(".overflow-y-auto")!.scrollTop = 7 * 56;
  });
  const rect = (await column.boundingBox())!;
  await dragTrayRow(page, title, { x: rect.x + rect.width / 2, y: rect.y + 14 * 56 });
  await expect(page.locator('[data-drop-placeholder-source="tray"]')).toBeVisible();
  await page.mouse.up();

  await expect(page.getByText("已排到 10月22日 14:00", { exact: true })).toBeVisible();
  const block = column.locator("button[data-calendar-task-id]", { hasText: title });
  await expect(block).toHaveCount(1);
  await expect(tray.getByText(title, { exact: true })).toHaveCount(0);

  // 撤销：定时块消失、任务回到托盘
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(block).toHaveCount(0);
  await expect(tray.getByText(title, { exact: true })).toBeVisible();
});
