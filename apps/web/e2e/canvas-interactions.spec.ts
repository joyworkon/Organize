import { expect, test, type Page, type Locator } from "@playwright/test";

async function openCanvas(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.getByRole("button", { name: "新建空白页面" }).click();
  await page.locator("[data-block-id] textarea").fill("模块甲");
}
async function exitEdit(page: Page) { await page.locator("[data-block-id] textarea").press("Escape"); }
async function columns(page: Page) {
  await page.locator("[data-block-id]").first().hover();
  await page.getByRole("button", { name: "在右侧添加一列", exact: true }).click();
  await page.locator("[data-block-id] textarea").fill("模块乙");
  await exitEdit(page);
}
async function drag(page: Page, from: Locator, x: number, y: number) {
  const box = (await from.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}
async function widths(page: Page) {
  return page.locator("[data-column-id]").evaluateAll((els) => els.map((e) => e.querySelector("[data-block-id]")!.getBoundingClientRect().width));
}

for (const zoom of [0.5, 1, 2]) test(`列宽拖动使用当前几何及 ${zoom * 100}% 缩放，等分和撤销生效`, async ({ page }) => {
  await openCanvas(page);
  await columns(page);
  const divider = page.getByRole("separator", { name: "拖动调整列宽" });
  const rect = (await divider.boundingBox())!;
  const oldZoom = Number((await page.locator(".canvas-zoom-value").textContent())!.replace("%", "")) / 100;
  await page.getByTestId("canvas-viewport").dispatchEvent("wheel", { ctrlKey: true, deltaY: -Math.log(zoom / oldZoom) / 0.002,
    clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 });
  const before = await widths(page);
  await expect(page.locator(".canvas-zoom-value")).toHaveText(`${zoom * 100}%`);
  const handle = (await divider.boundingBox())!;
  await drag(page, divider, handle.x + handle.width / 2 + 55 * zoom, handle.y + handle.height / 2);
  await expect.poll(async () => (await widths(page))[0] - before[0]).toBeCloseTo(55 * zoom, 0);
  await page.locator("[data-block-id]").first().click();
  await page.getByRole("button", { name: "等分", exact: true }).click();
  await expect.poll(async () => { const w = await widths(page); return Math.abs(w[0] - w[1]); }).toBeLessThan(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await widths(page))[0] - before[0]).toBeCloseTo(55 * zoom, 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await widths(page))[0]).toBeCloseTo(before[0], 0);
});

test("框选多个模块、整组跨列移动、删除与撤销", async ({ page }) => {
  await openCanvas(page);
  await columns(page);
  const blocks = page.locator("[data-block-id]");
  const a = (await blocks.first().boundingBox())!;
  const b = (await blocks.last().boundingBox())!;
  const board = (await page.locator("[data-board-id]").boundingBox())!;
  // Begin outside the board and include both module boxes.
  await page.mouse.move(board.x - 8, b.y + b.height + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 8, board.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator("[data-block-id].is-selected")).toHaveCount(2);
  const right = page.locator("[data-column-id]").last();
  await drag(page, blocks.first(), b.x + b.width / 2, b.y + b.height * 0.8);
  await expect(right.locator("[data-block-id]")).toHaveCount(2);
  await expect(page.locator("[data-column-id]").first().locator("[data-block-id]")).toHaveCount(0);
  await expect(page.locator("[data-block-id].is-selected")).toHaveCount(2);
  await page.getByRole("button", { name: "删除选中模块" }).click();
  await expect(page.locator("[data-block-id]")).toHaveCount(1);
  await expect(page.locator("[data-block-id]")).not.toContainText("模块甲");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(right.locator("[data-block-id]")).toHaveCount(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator("[data-column-id]").first().locator("[data-block-id]")).toHaveCount(1);
  expect(a.width).toBeGreaterThan(100);
});

test("模块跨区块移动保留文字，拖到空白后可以直接拖动自由内容", async ({ page }) => {
  await openCanvas(page);
  await exitEdit(page);
  const original = page.locator("[data-block-id]").first();
  const id = await original.getAttribute("data-block-id");
  await page.locator(".canvas-region-gap").last().hover();
  await page.getByRole("button", { name: "在下方添加区块" }).first().click();
  await page.locator("[data-block-id] textarea").fill("目标内容");
  await exitEdit(page);
  const destination = page.locator("[data-region-id]").last().locator("[data-block-id]").first();
  const box = (await destination.boundingBox())!;
  await drag(page, original, box.x + box.width / 2, box.y + box.height * 0.8);
  await expect(page.locator("[data-region-id]").last().locator(`[data-block-id="${id}"]`)).toHaveText("模块甲");
  const viewport = (await page.getByTestId("canvas-viewport").boundingBox())!;
  await drag(page, page.locator(`[data-block-id="${id}"]`), viewport.x + viewport.width / 2, viewport.y + viewport.height - 150);
  const free = page.locator("[data-free-item-id]");
  await expect(free).toContainText("模块甲");
  const from = (await free.boundingBox())!;
  await drag(page, free, from.x + from.width / 2 + 40, from.y + from.height / 2 + 25);
  await expect.poll(async () => (await free.boundingBox())!.x).toBeCloseTo(from.x + 40, 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await free.boundingBox())!.x).toBeCloseTo(from.x, 0);
});

test("横向滚轮和超过100%的双指缩放取消浏览器默认动作", async ({ page }) => {
  await openCanvas(page);
  await exitEdit(page);
  const errors: string[] = [];
  page.on("console", (m) => { if (/passive.*listener|preventDefault/i.test(m.text())) errors.push(m.text()); });
  const viewport = page.getByTestId("canvas-viewport");
  const url = page.url();
  const rect = (await viewport.boundingBox())!;
  const result = await viewport.evaluate((el, at) => {
    const pan = new WheelEvent("wheel", { deltaX: 240, deltaY: 0, bubbles: true, cancelable: true });
    const panResult = el.dispatchEvent(pan);
    const pinch = new WheelEvent("wheel", { deltaY: -500, ctrlKey: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true });
    const pinchResult = el.dispatchEvent(pinch);
    return { panResult, pinchResult, panCancelled: pan.defaultPrevented, pinchCancelled: pinch.defaultPrevented };
  }, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  expect(result).toEqual({ panResult: false, pinchResult: false, panCancelled: true, pinchCancelled: true });
  await expect.poll(async () => Number((await page.locator(".canvas-zoom-value").textContent())!.replace("%", ""))).toBeGreaterThan(100);
  const scale = await page.evaluate(() => window.visualViewport?.scale);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -180);
  await page.keyboard.up("Control");
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBe(scale);
  expect(page.url()).toBe(url);
  expect(errors).toEqual([]);
  const beforeGesture = Number((await page.locator(".canvas-zoom-value").textContent())!.replace("%", ""));
  const cancelled = await viewport.evaluate((el) => {
    const start = new Event("gesturestart", { bubbles: true, cancelable: true });
    el.dispatchEvent(start);
    const change = new Event("gesturechange", { bubbles: true, cancelable: true });
    Object.defineProperty(change, "scale", { value: 0.8 });
    el.dispatchEvent(change);
    el.dispatchEvent(new Event("gestureend", { bubbles: true, cancelable: true }));
    return start.defaultPrevented && change.defaultPrevented;
  });
  expect(cancelled).toBe(true);
  await expect.poll(async () => Number((await page.locator(".canvas-zoom-value").textContent())!.replace("%", ""))).toBeCloseTo(beforeGesture * 0.8, -1);
});

test("内容框四周留有16px内边距和浅色背景，显式内边距仍可修改", async ({ page }) => {
  await openCanvas(page);
  await exitEdit(page);
  const region = page.locator("[data-region-id]").first();
  const style = await region.evaluate((el) => ({ padding: getComputedStyle(el).padding, background: getComputedStyle(el).backgroundColor }));
  expect(style.padding).toBe("16px");
  expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
  await region.click({ position: { x: 5, y: 5 } });
  const padding = page.getByRole("spinbutton", { name: "区块内边距" });
  await expect(padding).toHaveValue("16");
  await padding.fill("24");
  await expect.poll(() => region.evaluate((el) => getComputedStyle(el).padding)).toBe("24px");
});

test("所在行的比例预设、列宽滑杆、行距及三种对齐都改变实际排版", async ({ page }) => {
  await openCanvas(page);
  await columns(page);
  const first = page.locator("[data-block-id]").first();
  const second = page.locator("[data-block-id]").last();
  await first.click();
  for (const [name, ratio] of [["1:2", 0.5], ["2:1", 2]] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect.poll(async () => { const w = await widths(page); return w[0] / w[1]; }).toBeCloseTo(ratio, 1);
  }
  await page.getByRole("slider", { name: "左列宽度占比" }).press("End");
  await expect.poll(async () => { const w = await widths(page); return w[0] / (w[0] + w[1]); }).toBeCloseTo(0.8, 1);
  await page.getByRole("button", { name: "等分", exact: true }).click();
  await page.getByRole("slider", { name: "行内间距" }).press("End");
  await expect.poll(async () => { const a = (await first.boundingBox())!, b = (await second.boundingBox())!; return b.x - a.x - a.width; }).toBeCloseTo(64, 0);
  await page.getByRole("radio", { name: "顶对齐", exact: true }).click();
  const a = (await first.boundingBox())!;
  await expect.poll(async () => (await second.boundingBox())!.y).toBeCloseTo(a.y, 0);
  expect((await second.boundingBox())!.height).toBeLessThan(a.height);
  await page.getByRole("radio", { name: "居中", exact: true }).last().click();
  await expect.poll(async () => { const b = (await second.boundingBox())!; return b.y + b.height / 2; }).toBeCloseTo(a.y + a.height / 2, 0);
  await page.getByRole("radio", { name: "底对齐", exact: true }).click();
  await expect.poll(async () => { const b = (await second.boundingBox())!; return b.y + b.height; }).toBeCloseTo(a.y + a.height, 0);
});

test("模块复制、上下移、禁用边界、删除和保存都接通", async ({ page }) => {
  await openCanvas(page);
  await exitEdit(page);
  await page.locator("[data-block-id]").click();
  await expect(page.getByRole("button", { name: "等分", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "上移", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "下移", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await page.locator("[data-block-id] textarea").fill("模块副本");
  await exitEdit(page);
  await page.getByRole("button", { name: "上移", exact: true }).click();
  await expect(page.locator("[data-block-id]").first()).toContainText("模块副本");
  await page.getByRole("button", { name: "下移", exact: true }).click();
  await expect(page.locator("[data-block-id]").first()).toContainText("模块甲");
  await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
  const id = page.url().split("/").pop()!;
  const saved = await page.evaluate(async (id) => (await fetch(`/api/canvases/${id}`)).json(), id);
  expect(saved.content.boards[0].regions[0].sections[0].columns[0].blocks.map((b: { text: string }) => b.text)).toEqual(["模块甲", "模块副本"]);
  await page.getByRole("button", { name: "删除模块", exact: true }).click();
  await expect(page.locator("[data-block-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator("[data-block-id]")).toHaveCount(2);
});

test("新建页面的移动手柄可见，页面拖动、改宽、删除与撤销生效", async ({ page }) => {
  await openCanvas(page);
  await exitEdit(page);
  const board = page.locator("[data-board-id]");
  await board.hover();
  const grip = page.getByRole("button", { name: "拖动移动版面", exact: true });
  const before = (await board.boundingBox())!;
  const handle = (await grip.boundingBox())!;
  const viewport = (await page.getByTestId("canvas-viewport").boundingBox())!;
  expect(handle.y).toBeGreaterThanOrEqual(viewport.y);
  await drag(page, grip, handle.x + handle.width / 2 + 35, handle.y + handle.height / 2 + 45);
  await expect.poll(async () => (await board.boundingBox())!.x).toBeCloseTo(before.x + 35, 0);
  await expect.poll(async () => (await board.boundingBox())!.y).toBeCloseTo(before.y + 45, 0);
  const resize = page.getByRole("button", { name: "拖动调整版面宽度", exact: true });
  const r = (await resize.boundingBox())!;
  await drag(page, resize, r.x + r.width / 2 + 50, r.y + r.height / 2);
  await expect.poll(async () => (await board.boundingBox())!.width).toBeCloseTo(before.width + 50, 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await board.boundingBox())!.width).toBeCloseTo(before.width, 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(async () => (await board.boundingBox())!.x).toBeCloseTo(before.x, 0);
  await board.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Delete");
  await expect(board).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(board).toHaveCount(1);
});

test("上传中的图片移成自由内容后原位完成，撤销移动不会回到无响应的上传占位", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __canvasMockUploadDelayMs: number }).__canvasMockUploadDelayMs = 2000; });
  await openCanvas(page);
  await exitEdit(page);
  await page.getByRole("button", { name: "添加图片", exact: true }).click();
  await page.getByTestId("canvas-image-input").setInputFiles({ name: "moving.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") });
  await expect(page.getByText("上传中…")).toBeVisible();
  const image = page.locator("[data-block-type=image]");
  const v = (await page.getByTestId("canvas-viewport").boundingBox())!;
  const board = (await page.locator("[data-board-id]").boundingBox())!;
  await drag(page, image, board.x + board.width + 80, v.y + v.height - 150);
  const free = page.locator("[data-free-item-id]");
  await expect(free).toHaveCount(1);
  await expect(free.locator("img")).toBeVisible();
  await expect(page.getByText("上传中…")).toHaveCount(0);
  await expect(free).toHaveCount(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(free).toHaveCount(0);
  await expect(page.locator("[data-block-type=image] img")).toBeVisible();
  await expect(page.getByText("上传中…")).toHaveCount(0);
});
