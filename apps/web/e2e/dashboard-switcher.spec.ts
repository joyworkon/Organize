import { expect, test } from "@playwright/test";
for (const width of [390, 768, 1440]) test(`工作台三个视图切换后按钮位置固定 (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "工作台视图" });
  await expect(tabs).toBeVisible();
  const before = await tabs.getByRole("tab").evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
  for (const view of ["日历回顾", "趋势统计", "今天"]) {
    await tabs.getByRole("tab", { name: view, exact: true }).click();
    await expect(tabs.getByRole("tab", { name: view, exact: true })).toHaveAttribute("aria-selected", "true");
    const after = await tabs.getByRole("tab").evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }));
    expect(after).toEqual(before);
    if (view !== "今天") await expect(page.getByRole("textbox", { name: "搜索工作台（标题 / 标签）" })).toHaveCount(0);
  }
});
