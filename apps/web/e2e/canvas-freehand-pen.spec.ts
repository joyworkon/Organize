import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });
const inkItems = (page: Page) => page.locator('[data-free-item-id][data-ink="true"]');
async function openCanvas(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.getByRole("button", { name: "自由放置", exact: true }).click();
}
async function startStroke(page: Page, x = 700, y = 330) {
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 50, y + 60, { steps: 8 });
  await page.mouse.move(x + 130, y + 20, { steps: 8 });
}
async function savedDoc(page: Page) {
  await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
  return page.evaluate(async () => (await (await fetch(`/api/canvases/${location.pathname.split("/").pop()}`)).json()).content);
}

for (const theme of ["light", "dark"]) {
  test(`${theme}：实时绘制、连续笔迹、属性、撤销、保存和只读预览`, async ({ page }, testInfo) => {
    await page.addInitScript((theme) => localStorage.setItem("organize-theme", theme), theme);
    await openCanvas(page);
    await page.getByRole("button", { name: "画笔", exact: true }).click();
    await expect(page.getByText("画笔模式 · Esc 退出")).toBeVisible();
    await page.mouse.click(700, 330);
    await expect(inkItems(page)).toHaveCount(0);
    await startStroke(page);
    await expect(page.getByTestId("canvas-ink-draft")).toBeVisible();
    await expect(inkItems(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(inkItems(page)).toHaveCount(1);
    const first = inkItems(page).first();
    const box = (await first.boundingBox())!;
    expect(box.x).toBeCloseTo(700, 0); expect(box.y).toBeCloseTo(330, 0);
    await expect(first.locator("path")).toHaveAttribute("stroke-width", "4");
    await startStroke(page, 720, 450); await page.mouse.up();
    await expect(inkItems(page)).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+z"); await expect(inkItems(page)).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Shift+z"); await expect(inkItems(page)).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(page.getByText("画笔模式 · Esc 退出")).toHaveCount(0);
    await first.click();
    await expect(page.getByRole("heading", { name: "笔迹", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "移入区块…" })).toHaveCount(0);
    await page.getByRole("radio", { name: "粗", exact: true }).click();
    await expect(first.locator("path")).toHaveAttribute("stroke-width", "8");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(first.locator("path")).toHaveAttribute("stroke-width", "4");
    await page.getByRole("radio", { name: "颜色：红", exact: true }).click();
    await expect(first.locator("path")).toHaveAttribute("stroke", "var(--cv-text-red)");
    const saved = await savedDoc(page);
    expect(saved.freeItems[0].block).toMatchObject({ type: "ink", color: "red", strokeWidth: 4 });
    expect(saved.freeItems[0].block.points.length).toBeLessThanOrEqual(2000);
    await page.screenshot({ path: testInfo.outputPath(`ink-${theme}.png`) });
    await page.getByRole("link", { name: "返回画布列表" }).click();
    await page.locator(".canvas-list-open").first().click();
    await expect(inkItems(page)).toHaveCount(2);
    await expect(first.locator("path")).toHaveAttribute("stroke", "var(--cv-text-red)");
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await page.keyboard.press("p");
    await expect(page.getByText("画笔模式 · Esc 退出")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "画笔", exact: true })).toHaveCount(0);
    await expect(first.locator(".canvas-resize-handle")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press("p");
    await expect(page.getByText("画笔模式 · Esc 退出")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "画笔", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "适合全部", exact: true }).click();
    await expect(first).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`ink-mobile-${theme}.png`) });
  });
}

test("P/输入框守卫、取消、穿过元素绘制、空格平移、缩放、锁定和复制粘贴", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "新建自由文本", exact: true }).click();
  const input = page.locator('[data-free-item-id] textarea');
  await input.fill("p"); await input.press("p");
  await expect(page.getByText("画笔模式 · Esc 退出")).toHaveCount(0);
  await input.press("Escape");
  await page.keyboard.press("p");
  await expect(page.getByText("画笔模式 · Esc 退出")).toBeVisible();
  await startStroke(page); await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(inkItems(page)).toHaveCount(0);
  await page.keyboard.press("p");
  await startStroke(page);
  await page.getByTestId("canvas-viewport").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  await expect(inkItems(page)).toHaveCount(0);
  // Starting on existing content is drawing, not moving or selecting it.
  const text = page.locator('[data-free-item-id]').first();
  const before = await text.getAttribute("style");
  const textBox = (await text.boundingBox())!;
  await startStroke(page, textBox.x + 10, textBox.y + 10); await page.mouse.up();
  await expect(inkItems(page)).toHaveCount(1);
  expect(await text.getAttribute("style")).toBe(before);
  const world = page.locator(".canvas-world"); const oldTransform = await world.getAttribute("style");
  await page.keyboard.down("Space");
  await page.mouse.move(850, 600); await page.mouse.down(); await page.mouse.move(890, 640); await page.mouse.up();
  await page.keyboard.up("Space");
  expect(await world.getAttribute("style")).not.toBe(oldTransform);
  await expect(inkItems(page)).toHaveCount(1);
  await page.keyboard.press("p");
  const item = inkItems(page).first(); await item.click();
  const width = parseFloat((await item.getAttribute("style"))!.match(/width: ([\d.]+)/)![1]);
  const height = (await item.boundingBox())!.height;
  const grip = (await item.locator('[data-resize-handle="se"]').boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 50, grip.y + grip.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(item).toHaveCSS("width", `${width + 50}px`);
  await expect(item).toHaveCSS("height", `${height + 30}px`);
  await page.getByRole("button", { name: "锁定自由元素", exact: true }).click();
  await expect(item.locator(".canvas-resize-handle")).toHaveCount(0);
  await page.getByRole("button", { name: "解锁自由元素", exact: true }).click();
  await item.focus(); await page.keyboard.press("ControlOrMeta+c"); await page.keyboard.press("ControlOrMeta+v");
  await expect(inkItems(page)).toHaveCount(2);
  await page.keyboard.press("Delete"); await expect(inkItems(page)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z"); await expect(inkItems(page)).toHaveCount(2);
});

test("50% 和 200% 缩放落笔坐标一致，笔迹可包含于 PNG 导出", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "新建空白页面", exact: true }).click();
  await page.locator('[data-block-id] textarea').fill("手绘导出"); await page.keyboard.press("Escape");
  for (const steps of [-3, 7]) {
    for (let i = 0; i < Math.abs(steps); i++) await page.getByRole("button", { name: steps < 0 ? "缩小" : "放大", exact: true }).click();
    await page.keyboard.press("p");
    await startStroke(page); await page.mouse.up(); await page.keyboard.press("Escape");
    const box = (await inkItems(page).last().boundingBox())!;
    expect(box.x).toBeCloseTo(700, 0); expect(box.y).toBeCloseTo(330, 0);
    expect(box.width).toBeCloseTo(130, 0); expect(box.height).toBeCloseTo(60, 0);
  }
  await page.getByRole("button", { name: "重置为 100%", exact: true }).click();
  await page.getByRole("button", { name: "结构", exact: true }).click();
  await page.getByRole("button", { name: "页面：页面 1", exact: true }).click();
  const board = (await page.locator('[data-board-id]').first().boundingBox())!;
  await page.keyboard.press("p");
  await startStroke(page, Math.max(600, board.x + 40), board.y + 35); await page.mouse.up(); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "页面：页面 1", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".canvas-property-bar").getByRole("button", { name: "导出页面为 PNG", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
  await expect(page.getByText("已导出 PNG")).toBeVisible();
});

test("笔迹连线、整组等比缩放、对齐、图层及删除撤销", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "画笔", exact: true }).click();
  await startStroke(page, 650, 300); await page.mouse.up();
  await startStroke(page, 850, 450); await page.mouse.up();
  await page.keyboard.press("Escape");
  const a = inkItems(page).first(), b = inkItems(page).nth(1);
  await a.click();
  await page.getByRole("button", { name: "连接到另一个元素", exact: true }).focus();
  await page.keyboard.press("Enter"); await b.focus(); await page.keyboard.press("Enter");
  await expect(page.locator('[data-connector-id]')).toHaveCount(1);
  await b.click();
  await page.getByRole("button", { name: "置于底层", exact: true }).click();
  const z = async (item: typeof a) => item.evaluate((el) => Number((el as HTMLElement).style.zIndex));
  expect(await z(b)).toBeLessThan(await z(a));
  await a.click({ modifiers: ["Shift"] });
  const group = page.locator(".canvas-free-group"); await expect(group).toBeVisible();
  const frame = (await group.boundingBox())!;
  const before = (await a.boundingBox())!;
  const grip = (await group.locator('[data-resize-handle="se"]').boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + frame.width / 5, grip.y + grip.height / 2 + frame.height / 5, { steps: 5 });
  await page.mouse.up(); await page.keyboard.up("Alt");
  const after = (await a.boundingBox())!;
  expect(after.width / before.width).toBeCloseTo(1.2, 2);
  expect(after.height / before.height).toBeCloseTo(1.2, 2);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await a.boundingBox())!.height).toBeCloseTo(before.height, 2);
  await page.getByRole("button", { name: "左对齐", exact: true }).click();
  expect((await a.boundingBox())!.x).toBeCloseTo((await b.boundingBox())!.x, 2);
  await a.focus(); await page.keyboard.press("Delete");
  await expect(inkItems(page)).toHaveCount(0); await expect(page.locator('[data-connector-id]')).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(inkItems(page)).toHaveCount(2); await expect(page.locator('[data-connector-id]')).toHaveCount(1);
});
