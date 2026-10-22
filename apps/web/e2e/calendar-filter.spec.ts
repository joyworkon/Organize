import { expect, test, type Page } from "@playwright/test";

/**
 * 日历筛选栏：标签 / 优先级 / 关键词筛选、条件 chip、空结果提示、按用户持久化。
 * mockDb 种子任务自带标签与优先级（固定时钟 2026-10-21，日程相对当天展开）：
 * - 「完成 Organize 任务功能开发」高 · [技术, 产品] · 10/23–25 跨天
 * - 「阅读 useEffect 完全指南并做笔记」中 · [技术, 阅读] · 10/22
 * - 「统一图标资产到设计系统」高 · [设计, 技术] · 10/22
 * - 「总结这季度的工作收获」中 · [产品] · 10/26
 * - 「整理本周收件箱」低 · [效率] · 10/24
 * 刷新只丢测试期新建的数据，种子数据与 localStorage 里的筛选条件都在。
 */

const MONTH_TASKS = '[data-calendar-surface="month"] [data-calendar-task-id]';

async function openCalendar(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 9, 21, 12));
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", "light");
  });
  await page.goto("/");
  await page.getByRole("link", { name: "全部待办", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\?scope=all$/);
  await page.getByRole("tab", { name: "日历", exact: true }).click();
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
}

/** 打开筛选弹层并完成操作后用 Esc 关闭（Radix 弹层会遮住日历断言）。 */
async function openFilterDialog(page: Page) {
  await page.getByRole("button", { name: "筛选日历任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "日历筛选条件" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function monthTask(page: Page, title: string) {
  return page.locator(MONTH_TASKS, { hasText: title });
}

test("按标签筛选只剩匹配任务；chip 逐个移除与「清除筛选」都能恢复", async ({ page }) => {
  await openCalendar(page);
  await expect(monthTask(page, "阅读 useEffect")).toHaveCount(1);
  await expect(monthTask(page, "总结这季度的工作收获")).toHaveCount(1);

  const dialog = await openFilterDialog(page);
  await dialog.getByRole("group", { name: "按标签筛选" }).getByRole("button", { name: "技术", exact: true }).click();
  await page.keyboard.press("Escape");

  // 只剩带「技术」标签的任务；无标签的任务与倒数日不受影响的核对见下
  await expect(monthTask(page, "阅读 useEffect")).toHaveCount(1);
  await expect(monthTask(page, "统一图标资产到设计系统")).toHaveCount(1);
  await expect(monthTask(page, "总结这季度的工作收获")).toHaveCount(0);
  await expect(monthTask(page, "整理本周收件箱")).toHaveCount(0);
  await expect(monthTask(page, "健身 - 跑步5公里")).toHaveCount(0);
  // 倒数日不受标签筛选影响（10/18 每年重复的「产品周年纪念日」仍在）
  await expect(page.locator('[data-calendar-surface="month"]').getByText("产品周年纪念日").first()).toBeVisible();

  // 按钮徽标与条件 chip
  const filterButton = page.getByRole("button", { name: "筛选日历任务", exact: true });
  await expect(filterButton).toContainText("1");
  const chips = page.getByRole("group", { name: "当前筛选条件" });
  await expect(chips.getByText("技术", { exact: true })).toBeVisible();

  // chip × 移除：恢复全部
  await page.getByRole("button", { name: "移除筛选条件：标签 技术", exact: true }).click();
  await expect(monthTask(page, "总结这季度的工作收获")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "当前筛选条件" })).toHaveCount(0);

  // 再选中后用「清除筛选」恢复
  const dialog2 = await openFilterDialog(page);
  await dialog2.getByRole("group", { name: "按标签筛选" }).getByRole("button", { name: "产品", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(monthTask(page, "阅读 useEffect")).toHaveCount(0);
  await expect(monthTask(page, "总结这季度的工作收获")).toHaveCount(1);
  await chips.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(monthTask(page, "阅读 useEffect")).toHaveCount(1);
  await expect(page.getByRole("group", { name: "当前筛选条件" })).toHaveCount(0);
});

test("标签+优先级+关键词 AND 组合；刷新后标签/优先级仍在、关键词清空", async ({ page }) => {
  await openCalendar(page);

  const dialog = await openFilterDialog(page);
  await dialog.getByRole("group", { name: "按标签筛选" }).getByRole("button", { name: "技术", exact: true }).click();
  await dialog.getByRole("group", { name: "按优先级筛选" }).getByRole("button", { name: "高", exact: true }).click();
  await dialog.getByRole("textbox", { name: "按关键词筛选", exact: true }).fill("开发");
  await page.keyboard.press("Escape");

  // AND：技术 + 高 + 标题含「开发」→ 只剩「完成 Organize 任务功能开发」
  await expect(monthTask(page, "完成 Organize 任务功能开发")).toHaveCount(1);
  await expect(monthTask(page, "统一图标资产到设计系统")).toHaveCount(0);
  await expect(monthTask(page, "阅读 useEffect")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "筛选日历任务", exact: true })).toContainText("3");

  // 刷新：标签与优先级持久化，关键词不持久化（种子数据刷新后重新就位）
  await page.reload();
  await expect(page.locator(".organize-calendar-screen .animate-spin")).toHaveCount(0);
  const chips = page.getByRole("group", { name: "当前筛选条件" });
  await expect(chips.getByText("技术", { exact: true })).toBeVisible();
  await expect(chips.getByText("优先级：高", { exact: true })).toBeVisible();
  await expect(chips.getByText("关键词：开发", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "筛选日历任务", exact: true })).toContainText("2");
  // 关键词清空后恢复为 技术+高 的结果：task-1 与 task-6 可见，中优先级的 task-2 仍隐藏
  await expect(monthTask(page, "完成 Organize 任务功能开发")).toHaveCount(1);
  await expect(monthTask(page, "统一图标资产到设计系统")).toHaveCount(1);
  await expect(monthTask(page, "阅读 useEffect")).toHaveCount(0);
});

test("筛选后可见范围无任务：显示轻提示并可一键清除", async ({ page }) => {
  await openCalendar(page);

  const dialog = await openFilterDialog(page);
  await dialog.getByRole("textbox", { name: "按关键词筛选", exact: true }).fill("不存在的关键词xyz");
  await page.keyboard.press("Escape");

  await expect(page.locator(MONTH_TASKS)).toHaveCount(0);
  const hint = page.getByRole("status").filter({ hasText: "当前筛选下没有任务" });
  await expect(hint).toBeVisible();
  // 轻提示不是弹窗：日历表面仍在
  await expect(page.locator('[data-calendar-surface="month"]')).toBeVisible();

  await hint.getByRole("button", { name: "清除筛选", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "当前筛选下没有任务" })).toHaveCount(0);
  await expect(monthTask(page, "阅读 useEffect")).toHaveCount(1);
  await expect(monthTask(page, "整理本周收件箱")).toHaveCount(1);
});
