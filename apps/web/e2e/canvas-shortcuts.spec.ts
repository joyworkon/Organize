import { expect, test, type Page } from "@playwright/test";

async function openCanvas(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.getByRole("button", { name: "新建空白页面", exact: true }).click();
  await expect(page.locator("[data-block-id] textarea")).toBeFocused();
}

async function viewport(page: Page) {
  return page.locator(".canvas-world").evaluate((el) => {
    const matrix = new DOMMatrix(getComputedStyle(el).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

test("全选复制一次撤销，文字输入与 IME 不触发画布复制", async ({ page }) => {
  await openCanvas(page);
  const editor = page.locator("[data-block-id] textarea");
  await editor.fill("保留文字编辑");
  await editor.press("Control+a");
  expect(await editor.evaluate((el: HTMLTextAreaElement) => el.selectionEnd - el.selectionStart)).toBe(6);
  await editor.press("Control+d");
  await expect(page.locator("[data-block-id]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "添加正文", exact: true }).click();
  await expect(page.locator("[data-block-id]")).toHaveCount(2);
  await page.keyboard.press("Escape");
  const focused = page.locator("[data-block-id]").last();
  for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
    await focused.dispatchEvent("keydown", { key: "d", ctrlKey: true, ...ime });
  }
  await expect(page.locator("[data-block-id]")).toHaveCount(2);
  await page.keyboard.press("Control+a");
  await expect(page.locator("[data-block-id].is-selected")).toHaveCount(2);
  await page.keyboard.press("Control+d");
  await expect(page.locator("[data-block-id]")).toHaveCount(4);
  await expect(page.locator("[data-block-id].is-selected")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-block-id]")).toHaveCount(2);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("[data-block-id]")).toHaveCount(4);
});

test("键盘与按钮围绕可视中心缩放，适合全部共用行为", async ({ page }) => {
  await openCanvas(page);
  await page.keyboard.press("Escape");
  const center = await page.getByTestId("canvas-shell").evaluate((shell) => {
    const rect = shell.getBoundingClientRect();
    const parent = shell.parentElement!;
    const left = parent.querySelector(".canvas-add-panel-wrap")!.getBoundingClientRect();
    const right = parent.querySelector(".canvas-property-bar")!.getBoundingClientRect();
    const x = Math.max(0, left.right - rect.left + 16);
    const end = Math.min(rect.width, right.left - rect.left - 16);
    return { x: x + Math.max(120, end - x) / 2, y: 40 + Math.max(120, rect.height - 104) / 2 };
  });
  const before = await viewport(page);
  const world = { x: (center.x - before.x) / before.zoom, y: (center.y - before.y) / before.zoom };
  for (const action of [
    () => page.keyboard.press("Control+="),
    () => page.getByRole("button", { name: "放大", exact: true }).click(),
    () => page.keyboard.press("Control+-"),
    () => page.getByRole("button", { name: "缩小", exact: true }).click(),
    () => page.keyboard.press("Control+0"),
    () => page.getByRole("button", { name: "重置为 100%", exact: true }).click(),
  ]) {
    await action();
    const next = await viewport(page);
    expect((center.x - next.x) / next.zoom).toBeCloseTo(world.x, 2);
    expect((center.y - next.y) / next.zoom).toBeCloseTo(world.y, 2);
  }
  expect((await viewport(page)).zoom).toBe(1);
  await page.keyboard.press("Shift+Digit1");
  const fit = await viewport(page);
  await page.keyboard.press("Control+0");
  await page.getByRole("button", { name: "适合全部", exact: true }).click();
  expect(await viewport(page)).toEqual(fit);
});

test("速查独立打开、弹层让位，预览只保留选择与视图快捷键", async ({ page }) => {
  await openCanvas(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Slash");
  const help = page.getByRole("dialog", { name: "键盘快捷键", exact: true });
  await expect(help).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(help).toContainText("全选画布模块");
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-block-id]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  const trigger = page.getByRole("button", { name: "键盘快捷键", exact: true });
  await trigger.click();
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.keyboard.press("Control+a");
  await expect(page.locator("[data-block-id].is-selected")).toHaveCount(1);
  await page.keyboard.press("Control+d");
  await expect(page.locator("[data-block-id]")).toHaveCount(1);
  await page.keyboard.press("Control+0");
  await page.keyboard.press("Control+=");
  expect((await viewport(page)).zoom).toBeCloseTo(1.2);
  await page.keyboard.press("Shift+Slash");
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "退出预览", exact: true })).toBeVisible();
});
