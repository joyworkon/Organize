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

test("回顾日期输入遵循手机触控和桌面密度，最窄屏幕不溢出", async ({ page }) => {
  await page.getByRole("tab", { name: "日历回顾", exact: true }).click();
  const picker = page.getByLabel("选择回顾日期", { exact: true });
  for (const width of [320, 390, 767, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await picker.boundingBox();
    expect(bounds!.height).toBe(width < 768 ? 44 : 32);
    expect(await picker.evaluate((el) => getComputedStyle(el).fontSize)).toBe(width < 768 ? "16px" : "14px");
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width < 768) {
      const previous = await page.getByRole("button", { name: "前一天", exact: true }).boundingBox();
      const today = await page.getByRole("button", { name: "回到今天", exact: true }).boundingBox();
      const next = await page.getByRole("button", { name: "后一天", exact: true }).boundingBox();
      expect(previous!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height);
      expect(today!.y).toBe(previous!.y);
      expect(next!.y).toBe(previous!.y);
    }
  }
});

test("回顾中的已完成任务可以直接打开对应详情", async ({ page }) => {
  await page.getByRole("tab", { name: "日历回顾", exact: true }).click();
  const completed = page.locator(".dashboard-card").filter({ has: page.getByRole("heading", { name: "完成任务（最多展示 10 条）", exact: true }) });
  const task = completed.getByRole("link", { name: /健身 - 跑步5公里/ });
  await expect(task).toHaveAttribute("href", /\/tasks\?scope=completed&task=/);
  await task.click();
  await expect(page).toHaveURL(/\/tasks\?scope=completed&task=/);
  await expect(page.getByRole("button", { name: "健身 - 跑步5公里", exact: true })).toBeVisible();
});

test("今天的任务支持键盘打开，手机完成按钮有独立触控范围", async ({ page }) => {
  const task = page.getByRole("link", { name: "打开任务：完成 Organize 任务功能开发", exact: true });
  await expect(task).toHaveAttribute("href", /\/tasks\?scope=all&task=/);
  await task.focus();
  await expect(task).toBeFocused();
  await task.press("Enter");
  await expect(page).toHaveURL(/\/tasks\?scope=all&task=/);
  await expect(page.getByRole("button", { name: "完成 Organize 任务功能开发", exact: true })).toBeVisible();

  await page.goto("/");
  await page.setViewportSize({ width: 320, height: 844 });
  const done = page.getByRole("button", { name: "标记完成", exact: true }).first();
  await expect(done).toBeVisible();
  const doneBox = await done.boundingBox();
  const linkBox = await page.getByRole("link", { name: "打开任务：完成 Organize 任务功能开发", exact: true }).boundingBox();
  expect(doneBox!.width).toBeGreaterThanOrEqual(44);
  expect(doneBox!.height).toBeGreaterThanOrEqual(44);
  expect(doneBox!.x + doneBox!.width).toBeLessThanOrEqual(linkBox!.x);
});
