import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });
async function openCanvas(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.getByRole("button", { name: "自由放置", exact: true }).click();
}
async function geometry(item: Locator) {
  return item.evaluate((el: HTMLElement) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) }));
}
async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
}
async function background(item: Locator, key: string) {
  await expect.poll(() => item.evaluate((el, key) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = key ? `var(--cv-bg-${key})` : "hsl(var(--card))";
    el.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(el).backgroundColor === expected;
  }, key)).toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}：新建、种类、色板、独立宽高、取消、历史和保存`, async ({ page }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("organize-theme", theme), theme);
    await openCanvas(page);
    await page.getByRole("button", { name: "新建矩形", exact: true }).focus();
    await page.keyboard.press("Enter");
    const item = page.locator("[data-free-item-id]");
    await expect(item).toHaveClass(/is-selected/);
    await expect(item).toHaveCSS("width", "160px");
    await expect(item).toHaveCSS("height", "126px");
    await expect(item).toHaveCSS("border-radius", "8px");
    await expect(item.locator("textarea, .canvas-image-placeholder")).toHaveCount(0);
    await expect(item.locator(".canvas-resize-handle")).toHaveCount(8);
    const topGrip = (await item.locator('[data-resize-handle="n"]').boundingBox())!;
    const topPort = (await item.locator('[data-connector-port="top"]').boundingBox())!;
    const moveGrip = (await item.locator(".canvas-free-move").boundingBox())!;
    expect(topPort.y + topPort.height).toBeLessThanOrEqual(topGrip.y);
    expect(moveGrip.y + moveGrip.height).toBeLessThanOrEqual(topPort.y);
    await expect(page.getByRole("heading", { name: "自由形状", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "移入区块…", exact: true })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(item).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(item).toHaveCount(1);
    await background(item, "blue");
    await item.dblclick();
    await expect(item.locator("textarea")).toHaveCount(0);
    await page.getByRole("radio", { name: "椭圆", exact: true }).click();
    await expect(item).toHaveCSS("border-radius", "50%");
    await expect(item).toHaveCSS("corner-shape", "round");
    await expect(page.getByRole("slider")).toHaveCount(0);
    await page.getByRole("radio", { name: "背景：绿", exact: true }).click();
    await background(item, "green");
    await page.screenshot({ path: testInfo.outputPath(`ellipse-${theme}.png`) });
    await page.getByRole("radio", { name: "背景：默认", exact: true }).click();
    await background(item, "");
    await item.click();
    await page.keyboard.press("ControlOrMeta+z");
    await background(item, "green");
    await page.getByRole("radio", { name: "矩形", exact: true }).click();
    await page.getByRole("slider").focus();
    await page.keyboard.press("End");
    await expect(item).toHaveCSS("border-radius", "32px");
    await item.click();
    const before = await geometry(item);
    await page.keyboard.down("Alt");
    await drag(page, item.locator('[data-resize-handle="se"]'), 60, 40);
    const live = await geometry(item);
    expect(live.width).toBeCloseTo(before.width + 60, 3);
    expect(live.height).toBeCloseTo(before.height + 40, 3);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(() => geometry(item)).toEqual(live);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => geometry(item)).toEqual(before);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => geometry(item)).toEqual(live);
    await drag(page, item.locator('[data-resize-handle="n"]'), 0, -35);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(() => geometry(item)).toEqual(live);
    await item.locator('[data-resize-handle="s"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await geometry(item)).height).toBe(live.height + 10);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => geometry(item)).toEqual(live);
    await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
    const saved = await page.evaluate(async () => (await (await fetch(`/api/canvases/${location.pathname.split("/").pop()}`)).json()).content);
    expect(saved.schemaVersion).toBe(2);
    expect(saved.freeItems[0]).toMatchObject({ width: live.width, block: { type: "shape", kind: "rect", height: live.height - 26, style: { background: "green", radius: 32 } } });
    await page.screenshot({ path: testInfo.outputPath(`shapes-${theme}.png`) });
    // SPA navigation reopens the server-acknowledged mock document.
    await page.getByRole("link", { name: "返回画布列表" }).click();
    await page.locator(".canvas-list-open").first().click();
    await expect(item).toHaveCSS("height", `${live.height}px`);
    await background(item, "green");
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.getByRole("button", { name: "新建矩形" })).toHaveCount(0);
    await expect(item.locator(".canvas-resize-handle, .canvas-connector-port")).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect(item).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "新建椭圆" })).toHaveCount(0);
    await expect(item.locator(".canvas-resize-handle")).toHaveCount(0);
  });
}

test("矩形/椭圆连接、组复制粘贴、图层、组缩放和删除级联", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "新建矩形", exact: true }).click();
  const a = page.locator("[data-free-item-id]").first();
  await drag(page, a.locator(".canvas-free-move"), -190, -80);
  await page.mouse.up();
  await page.getByRole("button", { name: "新建椭圆", exact: true }).click();
  const b = page.locator("[data-free-item-id]").nth(1);
  await expect(b).toHaveAttribute("data-shape-kind", "ellipse");
  await expect(b).toHaveCSS("border-radius", "50%");
  await page.getByRole("button", { name: "连接到另一个元素" }).focus();
  await page.keyboard.press("Enter");
  await a.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-connector-id]")).toHaveCount(1);
  await b.click();
  await page.getByRole("button", { name: "置于底层", exact: true }).click();
  expect(Number(await b.evaluate((el) => (el as HTMLElement).style.zIndex))).toBeLessThan(Number(await a.evaluate((el) => (el as HTMLElement).style.zIndex)));
  await page.getByRole("button", { name: "置于顶层", exact: true }).click();
  expect(Number(await b.evaluate((el) => (el as HTMLElement).style.zIndex))).toBeGreaterThan(Number(await a.evaluate((el) => (el as HTMLElement).style.zIndex)));
  await a.click({ modifiers: ["Shift"] });
  await expect(page.locator(".canvas-free-group")).toBeVisible();
  const before = [await geometry(a), await geometry(b)];
  const group = page.locator(".canvas-free-group");
  const frame = (await group.boundingBox())!;
  await page.keyboard.down("Alt");
  await drag(page, group.locator('[data-resize-handle="se"]'), frame.width / 4, frame.height / 4);
  const live = [await geometry(a), await geometry(b)];
  expect(live[0].height / before[0].height).toBeCloseTo(1.25, 2);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect.poll(async () => [await geometry(a), await geometry(b)]).toEqual(live);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => [await geometry(a), await geometry(b)]).toEqual(before);
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator("[data-free-item-id]")).toHaveCount(4);
  await expect(page.locator("[data-connector-id]")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-free-item-id]")).toHaveCount(2);
  await expect(page.locator("[data-connector-id]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-connector-id]")).toHaveCount(2);
});
