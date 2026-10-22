import { expect, test, type Locator, type Page } from "@playwright/test";

async function createText(page: Page, text: string) {
  const section = page.getByRole("button", { name: "自由放置", exact: true });
  if (await section.getAttribute("aria-expanded") !== "true") await section.click();
  await page.getByRole("button", { name: "新建自由文本", exact: true }).click();
  await page.getByRole("textbox", { name: "自由文本", exact: true }).fill(text);
  await page.keyboard.press("Escape");
}
async function geometry(item: Locator) {
  return item.evaluate((el: HTMLElement) => ({ x: el.style.left, y: el.style.top, width: el.style.width, height: el.style.height }));
}
async function drag(page: Page, item: Locator, dx: number, dy: number) {
  const rect = (await item.boundingBox())!;
  await page.mouse.move(rect.x + 30, rect.y + 30);
  await page.mouse.down();
  await page.mouse.move(rect.x + 30 + dx, rect.y + 30 + dy, { steps: 6 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
});

test("自由文本锁定防拖移和微移，可撤销、保存重载并解锁恢复拖动", async ({ page }, testInfo) => {
  await createText(page, "固定这段想法，排版时避免误碰");
  const item = page.locator("[data-free-item-id]");
  const before = await geometry(item);
  await page.getByRole("button", { name: "锁定自由元素", exact: true }).click();
  await expect(item).toHaveClass(/is-locked/);
  await expect(item.locator(".canvas-resize-handle")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "移入区块…", exact: true })).toBeDisabled();
  await drag(page, item, 90, 40);
  await item.press("ArrowRight");
  await item.press("Shift+ArrowDown");
  expect(await geometry(item)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(item).not.toHaveClass(/is-locked/);
  await expect(item.locator(".canvas-resize-handle")).toHaveCount(6);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(item).toHaveClass(/is-locked/);
  await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
  const url = page.url();
  const id = url.split("/").pop()!;
  const saved = await page.evaluate(async (id) => (await fetch(`/api/canvases/${id}`)).json(), id);
  expect(saved.content.schemaVersion).toBe(2);
  expect(saved.content.freeItems[0].locked).toBe(true);
  // Mock storage lives in memory: SPA leave/reopen reloads the saved document without resetting the backend.
  await page.getByRole("link", { name: "返回画布列表", exact: true }).click();
  await page.locator(".canvas-list-open").filter({ hasText: "固定这段想法" }).click();
  await expect(item).toHaveClass(/is-locked/);
  await item.click({ position: { x: 30, y: 30 } });
  await expect(page.getByRole("button", { name: "解锁自由元素", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("locked.png") });
  await page.getByRole("button", { name: "解锁自由元素", exact: true }).click();
  await expect(item.locator(".canvas-resize-handle")).toHaveCount(6);
  await page.keyboard.down("Alt");
  await drag(page, item, 90, 40);
  await page.keyboard.up("Alt");
  await expect.poll(() => geometry(item)).not.toEqual(before);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByRole("button", { name: "锁定自由元素", exact: true })).toHaveCount(0);
});

test("混合多选阻止整组移动缩放和对齐分布，右键与属性栏可统一锁定解锁", async ({ page }, testInfo) => {
  await createText(page, "固定元素");
  const first = page.locator("[data-free-item-id]").first();
  await page.keyboard.down("Alt");
  await drag(page, first, -220, -100);
  await page.keyboard.up("Alt");
  await page.getByRole("button", { name: "锁定自由元素", exact: true }).click();
  await createText(page, "可移动元素");
  const second = page.locator("[data-free-item-id]").last();
  await first.click({ position: { x: 30, y: 30 }, modifiers: ["Shift"] });
  const group = page.locator(".canvas-free-group");
  await expect(group).toBeVisible();
  await expect(group.locator(".canvas-resize-handle")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "左对齐", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "水平分布", exact: true })).toBeDisabled();
  const before = [await geometry(first), await geometry(second)];
  await drag(page, second, 60, 40);
  await second.press("Shift+ArrowRight");
  expect([await geometry(first), await geometry(second)]).toEqual(before);
  await second.click({ button: "right", position: { x: 30, y: 30 } });
  const menu = page.getByTestId("canvas-context-menu");
  await expect(menu.getByRole("menuitem", { name: "左对齐", exact: true })).toHaveAttribute("aria-disabled", "true");
  await menu.getByRole("menuitem", { name: "锁定所选", exact: true }).click();
  await expect(page.locator(".canvas-free-item.is-locked")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "解锁自由元素", exact: true })).toHaveText("解锁所选");
  await page.screenshot({ path: testInfo.outputPath("locked-group.png") });
  await page.getByRole("button", { name: "解锁自由元素", exact: true }).click();
  await expect(page.locator(".canvas-free-item.is-locked")).toHaveCount(0);
  await expect(group.locator(".canvas-resize-handle")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "左对齐", exact: true })).toBeEnabled();
  await page.keyboard.down("Alt");
  await drag(page, second, 60, 40);
  await page.keyboard.up("Alt");
  await expect.poll(() => geometry(first)).not.toEqual(before[0]);
  await expect.poll(() => geometry(second)).not.toEqual(before[1]);
});
