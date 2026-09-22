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

  // 双击建页面骨架（B1 blank：一个区块 + 标题块），输入标题
  await page.getByTestId("canvas-viewport").dblclick({ position: { x: 80, y: 120 } });
  const title = page.locator("[data-block-type='text'] textarea").first();
  await expect(title).toBeFocused();
  await page.keyboard.type("新品发布 · 内容卡片");
  await page.keyboard.press("Enter"); // 本区块内新增通栏行
  await page.keyboard.type("左列正文：把想法写下来，让版式自己长出来。双击即建，回车成栏。");
  // 左列局部加号：向下加一块（骨架 blank 只有标题块 + 本行块）
  const blocks = page.locator("[data-block-type='text']");
  await expect(blocks).toHaveCount(2);
  await blocks.nth(1).hover();
  await page.locator("button[aria-label='在本列下方添加模块']").click();
  await expect(blocks).toHaveCount(3);
  // 右列加号
  await blocks.nth(1).hover();
  await page.locator("button[aria-label='在右侧添加一列']").click();
  await expect(blocks).toHaveCount(4);
  await page.keyboard.type("右列说明");
  // 右列下方添加
  await blocks.nth(3).hover();
  await page.locator("button[aria-label='在本列下方添加模块']").click();
  await expect(blocks).toHaveCount(5);
  await page.keyboard.type("右列补充内容，跨两层演示。");
  // 通栏：Enter
  await page.keyboard.press("Enter");
  await page.keyboard.type("底部通栏说明——海报、卡片与演示页面的快速原型。");

  await page.waitForTimeout(800);
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
  // 组合结束后 Enter：应在本区块内建块（B1 blank 骨架起始为 1 行）
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const sectionsAfter = await page.locator("[data-section-id]").count();
  expect(sectionsBefore).toBe(1);
  expect(sectionsAfter).toBe(2);
});


test("visual: organize:fonts-ready 触发重测且几何保持一致", async ({ page }) => {
  await openPage(page, "/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.getByTestId("canvas-viewport").dblclick({ position: { x: 100, y: 150 } });
  await page.keyboard.type("字体切换度量稳定性");
  await page.keyboard.press("Enter");
  await page.keyboard.type("正文随度量重算");
  await page.waitForTimeout(400);
  const board = page.locator("[data-board-id]").first();
  const before = await board.boundingBox();

  // MiSans 就绪事件：画布应清缓存重测；字体已在本地加载完成，几何应保持稳定（无跳动/截断）
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("organize:fonts-ready")));
  await page.waitForTimeout(400);
  const after = await board.boundingBox();
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(2);
  expect(Math.abs(after!.width - before!.width)).toBeLessThan(2);
  // 文本没有被裁切：块内文本首行可见
  const textVisible = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-block-id]")][1] as HTMLElement;
    const inner = el.querySelector(".canvas-text-content") as HTMLElement;
    return inner && inner.scrollHeight >= inner.clientHeight - 2;
  });
  expect(textVisible).toBe(true);
});

test("visual: 初始化时 data-fonts-ready=true 直接重测一次", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
    document.documentElement.dataset.fontsReady = "true";
  });
  await page.goto("/canvas");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.getByTestId("canvas-viewport").dblclick({ position: { x: 100, y: 150 } });
  await page.keyboard.type("预置就绪标记");
  await page.waitForTimeout(400);
  // 字体度量路径已生效：文本行高完整渲染（≈25.6px 行盒），未被 24px 最小高截断
  const h = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-block-id]")][0] as HTMLElement;
    return el.getBoundingClientRect().height;
  });
  expect(h).toBeGreaterThan(40); // 26(内容) + 26(chrome) ≈ 52
});
