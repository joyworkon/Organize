import { expect, test, type Locator, type Page } from "@playwright/test";
import { createBoardShape, createTextBlock, emptyDoc } from "../lib/canvas/model";

async function openFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  const id = page.url().split("/").pop()!;
  let n = 0;
  const newId = () => `find-${++n}`;
  const doc = emptyDoc();
  const first = createBoardShape({ x: 0, y: 0 }, newId);
  first.name = "星河页面 A";
  first.regions[0].name = "星河区块";
  first.regions[0].sections[0].columns[0].blocks[0] = createTextBlock("body", "星河正文", newId);
  const second = createBoardShape({ x: 2400, y: 1200 }, newId);
  second.name = "星河页面 B";
  doc.boards = [first, second];
  doc.freeItems = [
    { id: "find-sticky", x: -800, y: 1500, width: 220, zIndex: 1, block: { ...createTextBlock("body", "星河便签", newId), style: { background: "yellow", radius: 8 } } },
    { id: "find-end", x: -300, y: 1500, width: 220, zIndex: 2, block: createTextBlock("body", "终点", newId) },
  ];
  doc.connectors = [{ id: "find-edge", from: "find-sticky", to: "find-end", label: "星河关系", arrow: "end", line: "solid", color: "" }];
  const response = await page.evaluate(async ({ id, doc }) => {
    const row = await (await fetch(`/api/canvases/${id}`)).json();
    const result = await fetch(`/api/canvases/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "查找验收", content: doc, expectedRevision: row.revision }) });
    return result.status;
  }, { id, doc });
  expect(response).toBe(200);
  await page.getByRole("link", { name: "返回画布列表", exact: true }).click();
  await page.getByRole("button", { name: /查找验收/ }).first().click();
  await expect(page.locator(".canvas-board")).toHaveCount(2);
  return { id, doc };
}

async function expectInViewport(page: Page, target: Locator) {
  await expect.poll(async () => {
    const shell = (await page.getByTestId("canvas-shell").boundingBox())!;
    const box = (await target.boundingBox())!;
    return box.x >= shell.x - 1 && box.y >= shell.y - 1 && box.x + box.width <= shell.x + shell.width + 1 && box.y + box.height <= shell.y + shell.height + 1;
  }).toBe(true);
}

async function expectFindControlsUnobstructed(bar: Locator) {
  for (const control of [bar.getByRole("textbox"), bar.getByRole("button", { name: "下一处", exact: true }), bar.getByRole("button", { name: "关闭画布查找", exact: true })]) {
    expect(await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
  }
}

test("Mod+F 查找页面/区块/正文/便签/连接线，循环选中并适合视口，保存内容不变", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { id, doc } = await openFixture(page);
  const before = await page.evaluate(async (id) => (await fetch(`/api/canvases/${id}`)).json(), id);
  await page.keyboard.press("Control+f");
  const bar = page.getByTestId("canvas-find-bar");
  const input = bar.getByRole("textbox", { name: "查找画布内容", exact: true });
  await expect(input).toBeFocused();
  await expect(bar.getByRole("status")).toHaveText("0 / 0");
  await input.fill("星河");
  const first = doc.boards[0];
  const targets = [
    `[data-board-id="${first.id}"]`,
    `[data-region-id="${first.regions[0].id}"]`,
    `[data-block-id="${first.regions[0].sections[0].columns[0].blocks[0].id}"]`,
    `[data-board-id="${doc.boards[1].id}"]`,
    '[data-free-item-id="find-sticky"]',
    '[data-connector-id="find-edge"]',
  ];
  for (const [index, selector] of targets.entries()) {
    await expect(bar.getByRole("status")).toHaveText(`${index + 1} / 6`);
    await expect(page.locator(selector)).toHaveClass(/is-selected/);
    if (index < 5) await expectInViewport(page, page.locator(selector));
    else {
      await expectInViewport(page, page.locator('[data-free-item-id="find-sticky"]'));
      await expectInViewport(page, page.locator('[data-free-item-id="find-end"]'));
    }
    if (index < 5) await input.press("Enter");
  }
  await input.press("Enter");
  await expect(bar.getByRole("status")).toHaveText("1 / 6");
  await input.press("Shift+Enter");
  await expect(bar.getByRole("status")).toHaveText("6 / 6");
  await page.keyboard.press("Meta+f");
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(2);
  await input.fill("无此内容");
  await expect(bar.getByRole("status")).toHaveText("0 / 0");
  await expect(page.locator(".canvas-find-hit")).toHaveCount(0);
  await input.fill("星河正文");
  await expectFindControlsUnobstructed(bar);
  await expect(page.locator(".canvas-find-hit")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("canvas-find-light.png") });
  await page.evaluate(() => {
    localStorage.setItem("organize-theme", "dark");
    window.dispatchEvent(new CustomEvent("organize:theme-mode-change"));
  });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({ path: testInfo.outputPath("canvas-find-dark.png") });
  await input.press("Escape");
  await expect(bar).toBeHidden();
  await expect(page.locator(".canvas-find-hit")).toHaveCount(0);
  const after = await page.evaluate(async (id) => (await fetch(`/api/canvases/${id}`)).json(), id);
  expect(after.content).toEqual(before.content);
  expect(after.revision).toBe(before.revision);
});

test("文字编辑/改名/IME/弹层让位，预览中 Esc 先关查找再退预览，手机可查", async ({ page }, testInfo) => {
  const { doc } = await openFixture(page);
  const bar = page.getByTestId("canvas-find-bar");
  await page.getByRole("textbox", { name: "画布名称", exact: true }).press("Control+f");
  await expect(bar).toBeHidden();
  const block = page.locator(`[data-block-id="${doc.boards[0].regions[0].sections[0].columns[0].blocks[0].id}"]`);
  await page.getByRole("button", { name: "适合全部", exact: true }).click();
  await block.focus();
  await block.press("Enter");
  await block.locator("textarea").press("Meta+f");
  await expect(bar).toBeHidden();
  await page.keyboard.press("Escape");
  for (const ime of [{ isComposing: true }, { keyCode: 229 }]) await block.dispatchEvent("keydown", { key: "f", ctrlKey: true, ...ime });
  await expect(bar).toBeHidden();
  await page.getByRole("button", { name: "查找画布内容", exact: true }).click();
  const input = bar.getByRole("textbox");
  await input.fill("星河");
  await input.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(bar).toBeVisible();
  await page.getByRole("button", { name: "键盘快捷键", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("查找画布内容");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(bar).toBeVisible();
  await input.press("Escape");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.keyboard.press("Control+f");
  await input.fill("星河页面 B");
  await expect(page.getByTestId("canvas-preview-pager")).toContainText("第 2 / 2 页");
  await input.press("Escape");
  await expect(bar).toBeHidden();
  await expect(page.getByRole("button", { name: "退出预览", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "预览", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "查找画布内容", exact: true }).click();
  await input.fill("星河便签");
  await expect(bar.getByRole("status")).toHaveText("1 / 1");
  await expectInViewport(page, page.locator('[data-free-item-id="find-sticky"]'));
  const bounds = (await bar.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await expectFindControlsUnobstructed(bar);
  await page.screenshot({ path: testInfo.outputPath("canvas-find-mobile.png") });
});
