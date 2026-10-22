import { expect, test, type Page } from "@playwright/test";

/**
 * 桌面「日程」视图：30 天按天分组列表 + 顶部已逾期组。
 * mockDb 种子（固定时钟 2026-10-21 12:00，timed 任务均在 12:00）：
 * - 健身 - 跑步5公里（已完成）· 10/21
 * - 阅读 useEffect 完全指南并做笔记 / 统一图标资产到设计系统 · 10/22
 * - 完成 Organize 任务功能开发 · 10/23–25 跨天
 * - 整理本周收件箱 · 10/24 ｜ 总结这季度的工作收获 · 10/26
 * - 倒数日：Cairn 发布日 2026-12-31（默认 30 天范围外）
 * 种子没有未完成且逾期的任务，「已逾期」组默认不出现；测试 2 现场建一个过去的任务。
 */

const AGENDA = '[data-calendar-surface="agenda"]';
const AGENDA_DAY = `${AGENDA} [data-agenda-day]`;
const AGENDA_TASKS = `${AGENDA} [data-calendar-task-id]`;
/** 组内作用域查询用（Playwright 链式 locator 的祖先条件也要落在子树内）。 */
const AGENDA_ROW = "[data-calendar-task-id]";

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

async function openAgenda(page: Page) {
  await page.getByRole("button", { name: "日程", exact: true }).click();
  await expect(page.getByRole("button", { name: "日程", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(AGENDA)).toBeVisible();
}

/** 标题 h2 的范围文案，如「10月21日 - 11月19日」。 */
function rangeTitle(page: Page) {
  return page.locator(".task-calendar-header h2");
}

test("切到日程视图：按钮与快捷键 a，按天分组 + 今天/明天标注 + 跨天口径", async ({ page }) => {
  await openCalendar(page);

  // 快捷键 a 与按钮等效
  await page.keyboard.press("a");
  await expect(page.getByRole("button", { name: "日程", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(rangeTitle(page)).toHaveText("10月21日 - 11月19日");
  await page.keyboard.press("m");
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await openAgenda(page);

  // 分组按日升序：只有有内容的日期出现（10/21, 22, 23, 24, 25, 26）
  await expect(page.locator(AGENDA_DAY)).toHaveCount(6);
  const firstDay = page.locator(AGENDA_DAY).first();
  await expect(firstDay).toHaveAttribute("data-agenda-today", "true");
  await expect(firstDay.getByText("今天", { exact: true })).toBeVisible();
  await expect(firstDay).toContainText("10月21日");
  await expect(firstDay).toContainText("健身 - 跑步5公里");
  const secondDay = page.locator(AGENDA_DAY).nth(1);
  await expect(secondDay.getByText("明天", { exact: true })).toBeVisible();
  await expect(secondDay).toContainText("10月22日");

  // 全天/定时 meta：种子任务均为 12:00 定时
  await expect(secondDay.locator(AGENDA_ROW).first()).toContainText("12:00");
  // 跨天任务在每个覆盖日出现：首日「共 3 天」，续日「第 n/3 天」
  await expect(page.locator(AGENDA_DAY).nth(2).locator(AGENDA_ROW).first()).toContainText("12:00 · 共 3 天");
  const day24 = page.locator(AGENDA_DAY).nth(3);
  await expect(day24).toContainText("10月24日");
  const continued = day24.locator('[data-agenda-span="continued"]');
  await expect(continued).toHaveCount(1);
  await expect(continued.first()).toContainText("跨天 · 第 2/3 天");
  // 延续中的任务排在当天新开始的任务之前
  await expect(day24.locator(AGENDA_ROW).first()).toContainText("完成 Organize 任务功能开发");
  await expect(page.locator(AGENDA_DAY).nth(4).locator(AGENDA_ROW).first()).toContainText("跨天 · 第 3/3 天");

  // 种子没有未完成且逾期的任务：逾期组不渲染
  await expect(page.locator("[data-agenda-overdue]")).toHaveCount(0);
});

test("已逾期组：顶部可折叠，现场创建的过去任务进入该组", async ({ page }) => {
  await openCalendar(page);
  // 月视图点 10/19 格子快速创建全天任务（相对固定时钟已逾期）
  await page.getByRole("gridcell", { name: "10月19日", exact: true }).click();
  const card = page.locator("[data-calendar-quick-create]");
  await card.getByRole("textbox", { name: "标题" }).fill("逾期补救任务");
  await card.getByRole("textbox", { name: "标题" }).press("Enter");
  await expect(card).toHaveCount(0);

  // 点过的格子会成为选中日；先回今天，让日程范围从今天起算（10/19 落在范围之前 → 已逾期组）
  await page.locator(".task-calendar-header").getByRole("button", { name: "今天", exact: true }).click();
  await openAgenda(page);
  const overdue = page.locator("[data-agenda-overdue]");
  await expect(overdue).toBeVisible();
  const toggle = overdue.getByRole("button", { name: /已逾期/ });
  await expect(toggle).toContainText("1");
  const row = overdue.locator(AGENDA_ROW);
  await expect(row).toHaveCount(1);
  await expect(row.first()).toContainText("逾期补救任务");
  await expect(row.first()).toContainText("10月19日");

  // 折叠/展开
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(overdue.locator(AGENDA_ROW)).toHaveCount(0);
  await toggle.click();
  await expect(overdue.locator(AGENDA_ROW)).toHaveCount(1);
  // 逾期任务不出现在范围分组里（10/19 在范围 10/21 之前）
  await expect(page.locator(AGENDA_DAY).filter({ hasText: "逾期补救任务" })).toHaveCount(0);
});

test("条目交互：点击打开 peek、行内勾选完成、右键菜单", async ({ page }) => {
  await openCalendar(page);
  await openAgenda(page);

  // 点击打开 peek（?task= + 详情面板），Esc 关闭
  const row = page.locator(AGENDA_DAY).nth(1).locator(AGENDA_ROW).first();
  await expect(row).toContainText("阅读 useEffect");
  await row.getByRole("button").first().click();
  await expect(page).toHaveURL(/task=/);
  await expect(page.locator(".organize-task-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/task=/);

  // 行内勾选完成：不打开详情，状态变为已完成
  const checkbox = page.getByRole("checkbox", { name: "完成任务：阅读 useEffect 完全指南并做笔记", exact: true });
  await checkbox.click();
  await expect(page).not.toHaveURL(/task=/);
  await expect(checkbox).toHaveAttribute("aria-checked", "true");

  // 右键菜单复用 calendar-task-menu
  await row.click({ button: "right" });
  const menu = page.getByTestId("calendar-task-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("calendar-task-menu-open")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("加载更多扩 30 天；上一页/下一页按 30 天平移；空范围给新建入口；今天回位", async ({ page }) => {
  await openCalendar(page);
  await openAgenda(page);

  await expect(rangeTitle(page)).toHaveText("10月21日 - 11月19日");
  await expect(page.locator(AGENDA)).not.toContainText("Cairn 发布日");
  const more = page.getByRole("button", { name: /加载更多/ });
  await more.click();
  await expect(rangeTitle(page)).toHaveText("10月21日 - 12月19日");
  await more.click();
  await expect(rangeTitle(page)).toHaveText("10月21日 - 1月18日");
  await expect(page.locator(AGENDA)).toContainText("Cairn 发布日");

  // 下一页：按 30 天平移且扩展页数归零；该范围无任务/倒数日 → 空态 + 新建入口
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(rangeTitle(page)).toHaveText("11月20日 - 12月19日");
  await expect(page.locator(AGENDA)).toContainText("这一范围还没有已排期任务或倒数日");
  await expect(page.locator(AGENDA).getByRole("button", { name: "新建任务", exact: true })).toBeVisible();

  // 上一页回到原范围；再翻走后「今天」回到今天起算的范围
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await expect(rangeTitle(page)).toHaveText("10月21日 - 11月19日");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.locator(".task-calendar-header").getByRole("button", { name: "今天", exact: true }).click();
  await expect(rangeTitle(page)).toHaveText("10月21日 - 11月19日");
  await expect(page.locator(`${AGENDA_DAY}[data-agenda-today="true"]`)).toHaveCount(1);
});

test("筛选与显示选项在日程视图同样生效", async ({ page }) => {
  await openCalendar(page);
  await openAgenda(page);

  // 关键词筛选：只剩 10/22 一组一条
  await page.getByRole("button", { name: "筛选日历任务", exact: true }).click();
  await page.getByRole("dialog", { name: "日历筛选条件" }).getByRole("textbox", { name: "按关键词筛选", exact: true }).fill("useEffect");
  await page.keyboard.press("Escape");
  await expect(page.locator(AGENDA_DAY)).toHaveCount(1);
  await expect(page.locator(AGENDA_TASKS)).toHaveCount(1);
  await expect(page.locator(AGENDA)).toContainText("阅读 useEffect");
  await expect(page.locator(AGENDA)).not.toContainText("统一图标资产");

  // 筛选到空：轻提示 + 清除筛选恢复
  await page.getByRole("button", { name: "筛选日历任务", exact: true }).click();
  await page.getByRole("dialog", { name: "日历筛选条件" }).getByRole("textbox", { name: "按关键词筛选", exact: true }).fill("不存在的关键词xyz");
  await page.keyboard.press("Escape");
  await expect(page.locator(AGENDA_TASKS)).toHaveCount(0);
  const hint = page.getByRole("status").filter({ hasText: "当前筛选下没有任务" });
  await expect(hint).toBeVisible();
  await hint.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(page.locator(AGENDA_DAY)).toHaveCount(6);

  // 「显示」菜单隐藏已完成：10/21 组整体消失（当天只有已完成的健身）
  await page.getByRole("button", { name: "日历显示选项", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "显示已完成任务", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(AGENDA_DAY)).toHaveCount(5);
  await expect(page.locator(AGENDA)).not.toContainText("健身 - 跑步5公里");
});
