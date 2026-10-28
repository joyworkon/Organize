import { expect, test, type Page } from "@playwright/test";

/**
 * 日历标题「跳转到日期」：点标题 / g 打开迷你月历面板，
 * 五模式落点（日/周/月/年/日程）、键盘 g·方向键·Enter·Esc、
 * 周起始日与隐藏周末口径、手机窄屏底部 Dialog。
 * mockDb 种子（固定时钟 2026-10-21 12:00）见 calendar-agenda-view.spec.ts。
 */

const PANEL = "[data-calendar-jump-panel]";
/** calendarDayKey 月份为 0 起：2026 年 10 月的键是 2026-9-x、11 月是 2026-10-x。 */

async function openCalendar(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 9, 21, 12));
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", "light");
  });
  await page.goto("/tasks/calendar");
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
}

function rangeTitle(page: Page) {
  return page.locator(".task-calendar-header h2");
}

function panel(page: Page) {
  return page.locator(PANEL);
}

test("月视图：点标题翻月选日；有安排的日子带圆点", async ({ page }) => {
  await openCalendar(page);

  await page.locator(".task-calendar-header [data-calendar-jump-trigger]").click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText("2026年10月");
  // 种子任务在 10/22（阅读 useEffect…）与 10/23–25（跨天），当天应有任务圆点
  await expect(panel(page).locator('[data-jump-day="2026-9-22"] [data-marker="task"]')).toHaveCount(1);
  await expect(panel(page).locator('[data-jump-day="2026-9-26"] [data-marker="task"]')).toHaveCount(1);
  await expect(panel(page).locator('[data-jump-day="2026-9-27"] [data-marker="task"]')).toHaveCount(0);

  await panel(page).getByRole("button", { name: "下一月" }).click();
  await expect(panel(page)).toContainText("2026年11月");
  await panel(page).locator('[data-jump-day="2026-10-15"]').click();
  await expect(panel(page)).toHaveCount(0);
  await expect(rangeTitle(page)).toHaveText("2026年11月");
  await expect(page.getByRole("gridcell", { name: "11月15日", exact: true })).toBeVisible();
});

test("键盘：g 打开并聚焦今天，方向键移动、Enter 选日、Esc 还焦点给触发器", async ({ page }) => {
  await openCalendar(page);

  await page.keyboard.press("g");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('[data-jump-day="2026-9-21"]')).toBeFocused();

  // 弹层打开时模式键让位；g 序列（g l → 资料库）也不会把人带走
  await page.keyboard.press("m");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("l");
  await expect(page).toHaveURL(/tasks\/calendar/);

  await page.keyboard.press("ArrowRight");
  await expect(panel(page).locator('[data-jump-day="2026-9-22"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(panel(page).locator('[data-jump-day="2026-9-29"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toHaveCount(0);
  await expect(rangeTitle(page)).toHaveText("2026年10月");

  await page.keyboard.press("g");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator(".task-calendar-header [data-calendar-jump-trigger]")).toBeFocused();
  // 关闭后单键模式键恢复正常（选日把 selectedDate 定在 10/29，日视图对齐到它）
  await page.keyboard.press("d");
  await expect(rangeTitle(page)).toHaveText("10月29日 周四");
});

test("日 / 周 / 年 / 日程四模式落点", async ({ page }) => {
  await openCalendar(page);

  // 日视图 → 那天
  await page.keyboard.press("d");
  await page.keyboard.press("g");
  await panel(page).locator('[data-jump-day="2026-9-26"]').click();
  await expect(panel(page)).toHaveCount(0); // 等退出动画结束，再按模式键
  await expect(rangeTitle(page)).toHaveText("10月26日 周一");

  // 周视图 → 含该日的那一周（周一起始把周日 11/1 归入 10/26 那周）
  await page.keyboard.press("w");
  await page.keyboard.press("g");
  await panel(page).getByRole("button", { name: "下一月" }).click();
  await panel(page).locator('[data-jump-day="2026-10-1"]').click();
  await expect(panel(page)).toHaveCount(0);
  await expect(rangeTitle(page)).toHaveText("10月26日 - 11月1日");

  // 年视图 → 先选年月再选日，直接进入该日的日视图
  await page.keyboard.press("y");
  await page.keyboard.press("g");
  await expect(panel(page).locator("[data-jump-month]")).toHaveCount(12);
  await panel(page).locator('[data-jump-month="11"]').click();
  await expect(panel(page)).toContainText("2026年12月");
  await panel(page).locator('[data-jump-day="2026-11-25"]').click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(rangeTitle(page)).toHaveText("12月25日 周五");

  // 日程视图 → 以该日为起点的 30 天窗口，目标日分组在视口顶部
  await page.keyboard.press("a");
  await page.keyboard.press("t"); // 先回今天，让面板从 10 月起步
  await page.keyboard.press("g");
  await panel(page).locator('[data-jump-day="2026-9-24"]').click();
  await expect(rangeTitle(page)).toHaveText("10月24日 - 11月22日");
  const surface = page.locator('[data-calendar-surface="agenda"]');
  const section = surface.locator('[data-agenda-day="2026-9-24"]');
  await expect(section).toBeVisible();
  const sectionTop = (await section.boundingBox())!.y;
  const surfaceTop = (await surface.boundingBox())!.y;
  expect(sectionTop - surfaceTop).toBeLessThan(64);
  await expect(section).toContainText("整理本周收件箱");
});

test("尊重显示选项：周日起始 + 隐藏周末（5 列表头、方向键跳过周末、周落点）", async ({ page }) => {
  await openCalendar(page);
  await page.getByRole("button", { name: "日历显示选项", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "显示周末", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "周日", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0); // 等菜单退出动画结束再按 g

  await page.keyboard.press("g");
  const headers = panel(page).locator(".grid.text-center > span");
  await expect(headers).toHaveCount(5);
  await expect(headers.first()).toHaveText("日");

  // 10/25 周日是首列；周四 10/22 右移跳过周五六日落到下周日 10/25
  await panel(page).locator('[data-jump-day="2026-9-22"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel(page).locator('[data-jump-day="2026-9-25"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  await page.keyboard.press("w");
  await page.keyboard.press("g");
  await panel(page).getByRole("button", { name: "下一月" }).click();
  await panel(page).locator('[data-jump-day="2026-10-1"]').click(); // 11/1 周日
  await expect(rangeTitle(page)).toHaveText("11月1日 - 5日"); // 周日起始的一周，隐藏周末到周四（同月省月名）
});

test("手机窄屏：底部 Dialog 同一套迷你月历，选日同步到手机月视图", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date(2026, 9, 21, 12));
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", "light");
  });
  await page.goto("/tasks/calendar");
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);

  await page.locator(".task-calendar-header [data-calendar-jump-trigger]").click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog.locator(PANEL)).toBeVisible();
  await dialog.locator(PANEL).locator('[data-jump-day="2026-9-26"]').click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  // 手机月视图自己的迷你月历选中 10/26
  await expect(page.locator('[data-calendar-surface="mini-month"] [data-mini-month-day="2026-9-26"]')).toHaveAttribute("aria-pressed", "true");
});
