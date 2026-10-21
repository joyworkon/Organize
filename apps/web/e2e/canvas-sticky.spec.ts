import { expect, test, type Locator, type Page } from "@playwright/test";

async function openCanvas(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
}

async function expectBackground(item: Locator, key: string) {
  await expect.poll(() => item.evaluate((el, key) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = key ? `var(--cv-bg-${key})` : "hsl(var(--card))";
    el.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(el).backgroundColor === expected;
  }, key)).toBe(true);
}

test("键盘新建便签自动聚焦，一次撤销整张便签，预览和手机隐藏入口", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "自由放置", exact: true }).click();
  const add = page.getByRole("button", { name: "新建便签", exact: true });
  await add.focus();
  await add.press("Enter");
  const item = page.locator("[data-free-item-id]");
  await expect(item.locator("textarea")).toBeFocused();
  await expect(item).toHaveClass(/is-selected/);
  await expectBackground(item, "yellow");
  await expect(item).toHaveCSS("border-radius", "8px");
  await page.keyboard.press("Meta+z");
  await expect(item).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+z");
  await expect(item).toHaveCount(1);
  await expectBackground(item, "yellow");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(add).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "背景", exact: true })).toHaveCount(0);
  await expectBackground(item, "yellow");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "自由放置", exact: true }).click();
  await expect(add).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(add).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}：普通文本染色、便签清除背景与撤销，样式写入自动保存`, async ({ page }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("organize-theme", theme), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCanvas(page);
    await page.getByRole("button", { name: "自由放置", exact: true }).click();
    await page.getByRole("button", { name: "新建自由文本", exact: true }).click();
    const item = page.locator("[data-free-item-id]");
    await item.locator("textarea").fill("构思：把零散想法放在一起");
    await page.getByRole("radio", { name: "背景：蓝", exact: true }).click();
    await expectBackground(item, "blue");
    await page.getByRole("radio", { name: "背景：绿", exact: true }).click();
    await expectBackground(item, "green");
    await page.getByRole("radio", { name: "背景：默认", exact: true }).click();
    await expectBackground(item, "");
    // 属性控件聚焦时回到画布再撤销，避免普通表单的原生快捷键语义。
    await item.click();
    await page.keyboard.press("Meta+z");
    await expectBackground(item, "green");
    // 把旧文本移到旁边，检查新旧内容共存，也让浅暗截图清楚展示两种色底。
    for (let i = 0; i < 26; i++) await item.press("Shift+ArrowLeft");
    await page.getByRole("button", { name: "新建便签", exact: true }).click();
    const sticky = item.last();
    await expect(sticky.locator("textarea")).toBeFocused();
    await sticky.locator("textarea").fill("下一步\n整理这个想法");
    await expect(sticky).toHaveCSS("width", "220px");
    await page.getByRole("radio", { name: "背景：默认", exact: true }).click();
    await expectBackground(sticky, "");
    await expect(sticky).toHaveCSS("border-radius", "8px");
    await sticky.click();
    await page.keyboard.press("Meta+z");
    await expectBackground(sticky, "yellow");
    await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
    const id = page.url().split("/").pop()!;
    const saved = await page.evaluate(async (id) => (await fetch(`/api/canvases/${id}`)).json(), id);
    expect(saved.content.freeItems[0].block.style.background).toBe("green");
    expect(saved.content.freeItems[1].block).toMatchObject({ text: "下一步\n整理这个想法", style: { background: "yellow", radius: 8 } });
    await page.screenshot({ path: testInfo.outputPath(`sticky-${theme}.png`) });
  });
}
