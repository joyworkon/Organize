import { expect, test, type Page } from "@playwright/test";

async function openCanvas(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await expect(page.getByText("还没有画布", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建构思画布", exact: true }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.getByRole("button", { name: "新建空白页面", exact: true }).click();
  await page.locator("[data-block-id] textarea").fill("保留文本和原模块");
  await page.keyboard.press("Escape");
}

test("属性栏抽出保留位置和内容，可拖动、一次撤销并移回区块", async ({ page }) => {
  await openCanvas(page);
  const block = page.locator(".canvas-board [data-block-id]");
  const blockId = await block.getAttribute("data-block-id");
  const before = (await block.boundingBox())!;
  await page.getByRole("button", { name: "转为自由定位", exact: true }).click();
  const free = page.locator(".canvas-free-item");
  await expect(free).toHaveCount(1);
  await expect(free).toContainText("保留文本和原模块");
  await expect(page.locator(`.canvas-board [data-block-id="${blockId}"]`)).toHaveCount(0);
  const after = (await free.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  await page.screenshot({ path: test.info().outputPath("detached-property-bar.png") });

  await page.keyboard.press("ControlOrMeta+z");
  await expect(free).toHaveCount(0);
  await expect(page.locator(`.canvas-board [data-block-id="${blockId}"].is-selected`)).toContainText("保留文本和原模块");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(free).toHaveCount(1);
  const originalLeft = await free.evaluate((el: HTMLElement) => el.style.left);
  const drag = (await free.boundingBox())!;
  await page.mouse.move(drag.x + 20, drag.y + 5);
  await page.mouse.down();
  await page.mouse.move(drag.x + 100, drag.y + 55, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => free.evaluate((el: HTMLElement) => el.style.left)).not.toBe(originalLeft);
  await page.getByRole("button", { name: "移入区块…", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "移入", exact: true }).click();
  await expect(free).toHaveCount(0);
  await expect(page.locator(`.canvas-board [data-block-id="${blockId}"]`)).toContainText("保留文本和原模块");
});

test("多选右键一次抽出，撤销恢复整批选区；预览入口禁用", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "添加正文", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator(".canvas-board [data-block-id].is-selected")).toHaveCount(2);
  await page.locator(".canvas-board [data-block-id]").last().click({ button: "right", position: { x: 10, y: 5 } });
  await page.getByRole("menuitem", { name: "转为自由定位", exact: true }).click();
  await expect(page.locator(".canvas-free-item.is-selected")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".canvas-free-item")).toHaveCount(0);
  await expect(page.locator(".canvas-board [data-block-id].is-selected")).toHaveCount(2);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.locator(".canvas-board [data-block-id]").first().click({ button: "right", position: { x: 10, y: 5 } });
  await expect(page.getByRole("menuitem", { name: "转为自由定位", exact: true })).toHaveAttribute("aria-disabled", "true");
});
