import { test, expect, type Page } from "@playwright/test";

/** 浏览器实测脚本：搭出完整骨架并截图（明/暗主题 + 手机只读 + 列表页）。 */
async function openPage(page: Page, path: string) {
  await page.addInitScript(() => { window.localStorage.setItem("organize:onboarded", "1"); });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

test("visual: 搭建完整骨架并截图", async ({ page }) => {
  await openPage(page, "/canvas");
  await page.screenshot({ path: "/tmp/canvas-list.png" });
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();

  // 双击建版面，输入标题
  await page.getByTestId("canvas-viewport").dblclick({ position: { x: 80, y: 120 } });
  const title = page.locator("[data-block-type='text'] textarea").first();
  await expect(title).toBeFocused();
  await page.keyboard.type("新品发布 · 内容卡片");
  await page.keyboard.press("Enter");
  await page.keyboard.type("左列正文：把想法写下来，让版式自己长出来。双击即建，回车成栏。");
  // 左列局部加号：向下加一块
  const blocks = page.locator("[data-block-type='text']");
  await blocks.nth(2).hover();
  await page.locator("button[aria-label='在本列下方添加模块']").click();
  await expect(blocks).toHaveCount(4);
  // 右列加号
  await blocks.nth(2).hover();
  await page.locator("button[aria-label='在右侧添加一列']").click();
  await expect(blocks).toHaveCount(5);
  await page.keyboard.type("右列说明");
  // 右列下方添加
  await blocks.nth(4).hover();
  await page.locator("button[aria-label='在本列下方添加模块']").click();
  await expect(blocks).toHaveCount(6);
  await page.keyboard.type("右列补充内容，跨两层演示。");
  // 通栏：Enter
  await page.keyboard.press("Enter");
  await page.keyboard.type("底部通栏说明——海报、卡片与演示页面的快速原型。");

  await page.waitForTimeout(800);
  const audit = await page.evaluate(() => {
    const board = document.querySelector("[data-board-id]") as HTMLElement;
    const sections = [...document.querySelectorAll("[data-section-id]")].map((el) => {
      const s = (el as HTMLElement).style;
      return `top=${s.top} h=${s.height}`;
    });
    const blocks = [...document.querySelectorAll("[data-block-id]")].map((el) => {
      const s = (el as HTMLElement).style;
      return `top=${s.top} h=${s.height}`;
    });
    return { boardH: board.style.height, sections, blocks };
  });
  console.log("AUDIT3:", JSON.stringify(audit));
  const rects = await page.evaluate(() => {
    const board = document.querySelector("[data-board-id]")!.getBoundingClientRect();
    const world = document.querySelector(".canvas-world")!.getBoundingClientRect();
    const blocks = [...document.querySelectorAll("[data-block-id]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { t: Math.round(r.top - board.top), b: Math.round(r.bottom - board.top), text: (el.textContent || "").slice(0, 8) };
    });
    return { boardH: Math.round(board.height), worldTop: Math.round(world.top), blocks };
  });
  console.log("RECTS:", JSON.stringify(rects));
  await page.screenshot({ path: "/tmp/canvas-editor-light.png" });

  // 暗色主题
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/canvas-editor-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // 预览模式
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/canvas-preview.png" });
  await page.keyboard.press("Escape");
});

test("visual: 手机只读预览", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPage(page, "/canvas");
  await page.screenshot({ path: "/tmp/canvas-mobile-list.png" });
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await page.waitForTimeout(1500);
  await expect(page.getByText("手机端仅支持只读预览")).toBeVisible();
  await page.screenshot({ path: "/tmp/canvas-mobile-readonly.png" });
});

test("visual: IME 组合期 Enter 不建块（合成事件模拟）", async ({ page }) => {
  await openPage(page, "/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.getByTestId("canvas-viewport").dblclick({ position: { x: 140, y: 130 } });
  const title = page.locator("[data-block-type='text'] textarea").first();
  await expect(title).toBeFocused();
  await page.keyboard.type("zhongwen");
  // 模拟 IME 组合：compositionstart → compositionupdate(Enter 按键 isComposing) → compositionend
  await title.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    el.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "中文" }));
    // 真实 IME 组合期间的 Enter 按键 keyCode=229 / isComposing=true
    const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(evt, "keyCode", { get: () => 229 });
    Object.defineProperty(evt, "isComposing", { get: () => true });
    el.dispatchEvent(evt);
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
  });
  await page.waitForTimeout(300);
  const sectionsBefore = await page.locator("[data-section-id]").count();
  // 组合结束后 Enter：应建块
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const sectionsAfter = await page.locator("[data-section-id]").count();
  expect(sectionsBefore).toBe(2);
  expect(sectionsAfter).toBe(3);
});
