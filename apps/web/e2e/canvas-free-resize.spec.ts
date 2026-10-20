import { expect, test, type Locator, type Page } from "@playwright/test";

async function createFreeText(page: Page, text: string) {
  const section = page.getByRole("button", { name: "自由放置", exact: true });
  if (await section.getAttribute("aria-expanded") !== "true") await section.click();
  await page.getByRole("button", { name: "新建自由文本" }).click();
  await page.getByRole("textbox", { name: "自由文本", exact: true }).fill(text);
  await page.keyboard.press("Escape");
  return page.locator(".canvas-free-item.is-selected");
}
async function box(item: Locator) {
  return item.evaluate((el: HTMLElement) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) }));
}
async function dragHandle(page: Page, handle: Locator, dx: number, dy: number) {
  const rect = (await handle.boundingBox())!;
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
});

test("自由文本左右锚点、测量底边、修饰键、尺寸和撤销", async ({ page }) => {
  const item = await createFreeText(page, "宽度改变后重新测量文本高度。".repeat(6));
  await expect(item.locator(".canvas-resize-handle")).toHaveCount(6);
  const before = await box(item);
  await page.keyboard.down("Alt");
  await dragHandle(page, item.locator(".canvas-resize-w"), -60, 0);
  await expect(page.locator(".canvas-resize-size")).toContainText(`${Math.round(before.width + 60)} px`);
  const live = await box(item);
  expect(live.x + live.width).toBeCloseTo(before.x + before.width, 4);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator(".canvas-resize-size")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => box(item)).toEqual(before);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => box(item)).toEqual(live);

  await page.keyboard.down("Shift");
  await page.keyboard.down("Alt");
  await dragHandle(page, item.locator(".canvas-free-resize"), 30, 0);
  const centered = await box(item);
  expect(centered.width).toBeCloseTo(live.width + 60, 4);
  expect(centered.x + centered.width / 2).toBeCloseTo(live.x + live.width / 2, 4);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
  await expect.poll(() => box(item)).toEqual(live);

  // Capture-phase workspace shortcuts must leave the left handle's width key alone.
  await item.locator(".canvas-resize-w").focus();
  await page.keyboard.press("ArrowLeft");
  const keyed = await box(item);
  expect(keyed.x).toBe(live.x - 10);
  expect(keyed.width).toBe(live.width + 10);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => box(item)).toEqual(live);

  await page.keyboard.down("Alt");
  await dragHandle(page, item.locator(".canvas-resize-ne"), -80, 30);
  const topLive = await box(item);
  expect(topLive.y + topLive.height).toBeCloseTo(live.y + live.height, 4);
  await page.screenshot({ path: test.info().outputPath("single-resize.png") });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect.poll(async () => { const b = await box(item); return b.y + b.height; }).toBeCloseTo(live.y + live.height, 4);
});

test("多选缩放保持比例和选择，一步撤销/重做；屏幕命中区恒定", async ({ page }) => {
  await createFreeText(page, "第一张卡片\n第二行\n第三行");
  const first = page.locator(".canvas-free-item").first();
  await dragHandle(page, first.locator(".canvas-free-move"), -180, -80);
  await page.mouse.up();
  await createFreeText(page, "第二张卡片\n第二行\n第三行");
  const second = page.locator(".canvas-free-item").last();
  await first.click({ position: { x: 20, y: 30 }, modifiers: ["Shift"] });
  const group = page.locator(".canvas-free-group");
  await expect(group.locator(".canvas-resize-handle")).toHaveCount(6);
  const a = await box(first);
  const b = await box(second);
  const frame = (await group.boundingBox())!;
  await page.keyboard.down("Alt");
  await dragHandle(page, group.locator(".canvas-resize-se"), frame.width / 4, frame.height / 4);
  const afterA = await box(first);
  const afterB = await box(second);
  const scale = afterA.width / a.width;
  expect(scale).toBeCloseTo(1.25, 1);
  expect(afterB.width / b.width).toBeCloseTo(scale, 4);
  expect(afterB.x - afterA.x).toBeCloseTo((b.x - a.x) * scale, 4);
  expect(afterB.y - afterA.y).toBeCloseTo((b.y - a.y) * scale, 4);
  await page.screenshot({ path: test.info().outputPath("group-resize.png") });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => box(first)).toEqual(a);
  await expect.poll(() => box(second)).toEqual(b);
  await expect(group).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => box(first)).toEqual(afterA);
  await expect.poll(() => box(second)).toEqual(afterB);
  await page.keyboard.press("ControlOrMeta+-");
  const handle = (await group.locator(".canvas-resize-e").boundingBox())!;
  expect(handle.width).toBeCloseTo(24, 1);
  expect(handle.height).toBeCloseTo(24, 1);
});
