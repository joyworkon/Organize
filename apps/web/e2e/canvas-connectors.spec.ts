import { expect, test, type Page, type Locator } from "@playwright/test";

test.use({ hasTouch: true });
async function createText(page: Page, text: string, dx: number, dy: number) {
  const free = page.getByRole("button", { name: "自由放置", exact: true });
  if (await free.getAttribute("aria-expanded") !== "true") await free.click();
  await page.getByRole("button", { name: "新建自由文本" }).click();
  await page.getByRole("textbox", { name: "自由文本", exact: true }).fill(text);
  await page.keyboard.press("Escape");
  const item = page.locator(".canvas-free-item.is-selected");
  const id = await item.getAttribute("data-free-item-id");
  const handle = (await item.locator(".canvas-free-move").boundingBox())!;
  await page.mouse.move(handle.x + 20, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 20 + dx, handle.y + handle.height / 2 + dy, { steps: 5 });
  await page.mouse.up();
  return page.locator(`[data-free-item-id="${id}"]`);
}
async function setup(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  const a = await createText(page, "起点卡片", -160, -100);
  const b = await createText(page, "目标卡片", 180, 140);
  return { a, b };
}
async function lineGeometry(page: Page) {
  return page.locator(".canvas-connector-line").first().evaluate((el) => ["x1", "y1", "x2", "y2"].map((key) => Number(el.getAttribute(key))));
}
async function selectLine(page: Page, line: Locator) {
  await line.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("toolbar", { name: "连接线属性" })).toBeVisible();
}

for (const width of [390, 1440]) {
  test(`连接、样式、标签、保存与历史 ${width}`, async ({ page }) => {
    const { a, b } = await setup(page);
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "适合全部", exact: true }).click();
    if (width === 390) {
      await expect(page.getByRole("note")).toContainText("点“连接”");
      await a.tap({ position: { x: 15, y: 15 } });
      await page.getByRole("button", { name: "连接到另一个元素" }).tap();
      await expect(page.getByRole("status").filter({ hasText: "点选另一个元素" })).toBeVisible();
      await b.tap({ position: { x: 15, y: 15 } });
    } else {
      await a.click({ position: { x: 15, y: 15 } });
      const port = (await a.getByRole("button", { name: "从右边连接" }).boundingBox())!;
      const target = (await b.boundingBox())!;
      await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + 20, target.y + 20, { steps: 6 });
      await expect(page.locator(".canvas-connector-draft")).toHaveCount(1);
      await page.mouse.up();
    }
    const line = page.locator("[data-connector-id]");
    await expect(line).toHaveCount(1);
    await page.getByLabel("连接线箭头样式").selectOption("none");
    await expect(line.locator(".canvas-connector-line")).not.toHaveAttribute("marker-end");
    await page.getByLabel("连接线箭头样式").selectOption("end");
    await expect(line.locator(".canvas-connector-line")).toHaveAttribute("marker-end", /url/);
    await page.getByLabel("连接线箭头样式").selectOption("both");
    await page.getByLabel("连接线线型", { exact: true }).selectOption("dashed");
    await page.getByRole("button", { name: "连接线颜色：蓝", exact: true }).click();
    // Double-clicking the real segment focuses the short label editor.
    await line.locator(".canvas-connector-hit").dblclick();
    const label = page.getByRole("textbox", { name: "连接线标签" });
    await label.fill("下一步");
    await page.keyboard.press("Enter");
    await expect(line.locator("text")).toHaveText("下一步");
    await expect(line.locator(".canvas-connector-line")).toHaveAttribute("stroke-dasharray", /.+/);
    await expect(line.locator(".canvas-connector-line")).toHaveAttribute("marker-start", /url/);
    await page.getByRole("button", { name: "适合选区", exact: true }).click();
    const toolbar = (await page.getByRole("toolbar", { name: "连接线属性" }).boundingBox())!;
    expect(toolbar.x).toBeGreaterThanOrEqual(0);
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(width);
    for (const swatch of await page.getByRole("group", { name: "连接线颜色", exact: true }).getByRole("button").all()) {
      const rect = (await swatch.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    }
    const notice = width === 390 ? await page.getByRole("note").boundingBox() : null;
    if (notice) expect(toolbar.y).toBeGreaterThanOrEqual(notice.y + notice.height);
    await page.screenshot({ path: test.info().outputPath(`connectors-${width}.png`) });
    // Persist through the same autosave/revision path as all other canvas content.
    await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
    const persisted = await page.evaluate(async () => {
      const url = `/api/canvases/${location.pathname.split("/").pop()}`;
      const current = await (await fetch(url)).json();
      const stale = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { ...current.content, connectors: [] }, expected_revision: current.revision - 1 }) });
      const latest = await (await fetch(url)).json();
      return { status: stale.status, content: latest.content, revision: latest.revision, previous: current.revision };
    });
    expect(persisted.status).toBe(409);
    expect(persisted.revision).toBe(persisted.previous);
    expect(persisted.content.connectors).toMatchObject([{ arrow: "both", line: "dashed", color: "blue", label: "下一步" }]);
    // Mock rows live in the SPA; remount via navigation to verify the saved document.
    await page.getByRole("link", { name: "返回画布列表" }).click();
    await page.locator(".canvas-list-open").filter({ hasText: "起点卡片" }).first().click();
    await expect(page.locator("[data-connector-id] text")).toHaveText("下一步");
    await selectLine(page, page.locator("[data-connector-id]"));
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-connector-id]")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator("[data-connector-id] text")).toHaveText("下一步");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.locator("[data-connector-id]")).toHaveCount(0);
  });
  test(`键盘连接与标签编辑、只读预览 ${width}`, async ({ page }) => {
    const { a, b } = await setup(page);
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "适合全部", exact: true }).click();
    if (width === 390) { await a.focus(); await page.keyboard.press("Enter"); }
    else await a.click({ position: { x: 15, y: 15 } });
    await page.getByRole("button", { name: "连接到另一个元素" }).focus();
    await page.keyboard.press("Enter");
    await b.focus(); await page.keyboard.press("Enter");
    const edge = page.locator("[data-connector-id]");
    await expect(edge).toHaveCount(1);
    await edge.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "连接线标签" })).toBeFocused();
    await page.keyboard.type("键盘标签"); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.locator(".canvas-connector-port")).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "连接线属性" })).toHaveCount(0);
    await expect(edge).not.toHaveAttribute("tabindex");
    await page.keyboard.press("Delete"); await expect(edge).toHaveCount(1);
    await page.getByRole("button", { name: "退出预览", exact: true }).click();
    await selectLine(page, edge);
    await page.keyboard.press("Backspace"); await expect(edge).toHaveCount(0);
  });
}

test("拖线取消、实时跟随、级联删除、组复制粘贴与预览", async ({ page }) => {
  const { a, b } = await setup(page);
  await a.click({ position: { x: 15, y: 15 } });
  const port = a.getByRole("button", { name: "从下边连接" });
  const p = (await port.boundingBox())!;
  await page.mouse.move(p.x + 12, p.y + 12); await page.mouse.down();
  await page.mouse.move(p.x + 80, p.y + 100); await page.mouse.up();
  await expect(page.locator("[data-connector-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "连接到另一个元素" }).click();
  await page.keyboard.press("Escape");
  await b.click({ position: { x: 15, y: 15 } });
  await expect(page.locator("[data-connector-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "连接到另一个元素" }).click();
  await a.click({ position: { x: 15, y: 15 } });
  const before = await lineGeometry(page);
  await b.click({ position: { x: 15, y: 15 } });
  const move = (await b.locator(".canvas-free-move").boundingBox())!;
  await page.mouse.move(move.x + 20, move.y + 7); await page.mouse.down();
  await page.mouse.move(move.x + 80, move.y + 60, { steps: 5 });
  await expect.poll(() => lineGeometry(page)).not.toEqual(before);
  const live = await lineGeometry(page);
  await page.mouse.up();
  await expect.poll(() => lineGeometry(page)).toEqual(live);
  // Resize updates the line before pointer-up, then undo as a single transaction.
  const resize = (await b.locator(".canvas-resize-w").boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(resize.x + 12, resize.y + 12); await page.mouse.down();
  await page.mouse.move(resize.x - 66, resize.y + 12, { steps: 5 });
  await expect.poll(() => lineGeometry(page)).not.toEqual(live);
  await page.mouse.up(); await page.keyboard.up("Alt");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => lineGeometry(page)).toEqual(live);
  await a.click({ position: { x: 15, y: 15 }, modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".canvas-free-item")).toHaveCount(4);
  await expect(page.locator("[data-connector-id]")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-connector-id]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-connector-id]")).toHaveCount(2);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.locator(".canvas-connector-port")).toHaveCount(0);
  await expect(page.locator("[data-connector-id]")).toHaveCount(2);
  await expect(page.getByRole("toolbar", { name: "连接线属性" })).toHaveCount(0);
});
