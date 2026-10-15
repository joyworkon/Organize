import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "快速记录", exact: true })).toBeVisible();
});

test("未提交的快速记录在切换视图、刷新数据和重开后保留", async ({ page }) => {
  const capture = page.getByRole("textbox", { name: "快速记录", exact: true });
  const draft = "明天整理阅读笔记，这段还没有提交";
  await capture.fill(draft);
  await page.getByRole("tab", { name: "日历回顾", exact: true }).click();
  await expect(page.getByRole("tab", { name: "日历回顾", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "今天", exact: true }).click();
  await expect(capture).toHaveValue(draft);

  // 标记已有任务会重新加载工作台；刷新不得卸载并清空正在编辑的输入。
  await page.getByRole("button", { name: "标记完成", exact: true }).first().click();
  await expect(capture).toHaveValue(draft);
  await page.reload();
  await expect(capture).toHaveValue(draft);
});

test("新建无日期待办后可从工作台打开具体任务", async ({ page }) => {
  const title = "工作台回归：整理今天的资料";
  await page.getByRole("textbox", { name: "快速记录", exact: true }).fill(`待办：${title}`);
  await page.getByRole("button", { name: "保存为待办", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  const openTask = page.getByRole("link", { name: "打开任务", exact: true });
  await expect(openTask).toHaveAttribute("href", /\/tasks\?scope=all&task=/);
  await openTask.click();
  await expect(page).toHaveURL(/\/tasks\?scope=all&task=/);
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
});

test("全部待办入口保持全部范围，继续阅读包含在读文章", async ({ page }) => {
  await expect(page.getByRole("link", { name: "全部待办", exact: true })).toHaveAttribute("href", "/tasks?scope=all");
  const reading = page.locator(".dashboard-card").filter({ has: page.getByRole("heading", { name: "继续阅读", exact: true }) });
  await expect(reading.getByRole("link", { name: /useEffect 完全指南/ })).toBeVisible();
  await expect(reading.getByRole("link", { name: /useEffect 完全指南/ })).toContainText("42%");
  await page.getByRole("link", { name: "全部待办", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\?scope=all$/);
  await expect(page.getByRole("heading", { name: "全部任务", exact: true })).toBeVisible();
});

test("手机回顾日期控件不挤压标题，历史空日期不混入今天的数据", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "日历回顾", exact: true }).click();
  const dateInput = page.getByLabel("选择回顾日期", { exact: true });
  await dateInput.fill("2000-01-02");
  await expect(page).toHaveURL(/reviewDate=2000-01-02/);
  await expect(page.getByText("这一天还没有完成任务，加油 💪", { exact: true })).toBeVisible();
  await expect(page.getByText("这一天还没有阅读记录", { exact: true })).toBeVisible();
  const title = await page.getByRole("heading", { name: "日历回顾", exact: true }).boundingBox();
  const picker = await dateInput.boundingBox();
  expect(title!.width).toBeGreaterThan(100);
  expect(picker!.y).toBeGreaterThan(title!.y + title!.height);
  expect(picker!.x + picker!.width).toBeLessThanOrEqual(390);
});
