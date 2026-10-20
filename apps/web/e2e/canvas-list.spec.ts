import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await expect(page.getByText("还没有画布")).toBeVisible();
  await page.evaluate(async () => {
    const block = { id: "text", type: "text", role: "body", text: "秋日阅读计划：读书与旅行" };
    const image = { id: "image", type: "image", fit: "contain", asset: { url: "https://example.com/do-not-load.png", naturalWidth: 800, naturalHeight: 600 } };
    const docs = [
      { title: "阅读计划", content: { schemaVersion: 2, boards: [{ id: "board", x: 0, y: 0, width: 640, padding: 24, gap: 16, regions: [{ id: "region", name: "内容", sections: [{ id: "section", widthMode: "equal", columnWeights: [1, 1], columns: [{ id: "col1", blocks: [block] }, { id: "col2", blocks: [image] }] }] }] }], freeItems: [] } },
      { title: "图片灵感", content: { schemaVersion: 2, boards: [], freeItems: [{ id: "free-image", x: -200, y: 100, width: 320, zIndex: 0, block: image }] } },
      { title: "空白想法", content: { schemaVersion: 2, boards: [], freeItems: [] } },
      { title: "自由笔记", content: { schemaVersion: 2, boards: [], freeItems: [{ id: "free-text", x: 0, y: 100, width: 320, zIndex: 0, block }] } },
    ];
    for (const doc of docs) {
      const response = await fetch("/api/canvases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...doc, id: crypto.randomUUID() }) });
      if (!response.ok) throw new Error(await response.text());
    }
  });
  // 用现有导航触发列表重载，保持 mock 内存库。
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.getByRole("link", { name: "返回画布列表" }).click();
  await expect(page.locator(".canvas-list-card")).toHaveCount(5);
}

for (const width of [390, 1440]) {
  test(`canvas list ${width}: 内容预览、搜索、菜单、撤销与键盘`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const requestedImages: string[] = [];
    page.on("request", (request) => { if (request.url().includes("do-not-load.png")) requestedImages.push(request.url()); });
    await seed(page);
    const preview = page.locator(".canvas-list-card").filter({ hasText: "阅读计划" }).filter({ has: page.getByRole("button", { name: /画布操作：阅读计划/ }) });
    await expect(preview.locator(".canvas-list-thumbnail svg").first()).toBeVisible();
    await expect(preview).toContainText("1 个版面 · 约 2 个块");
    await expect(page.locator(".canvas-list-card").filter({ hasText: "图片灵感" })).toContainText("暂无文字摘要");
    expect(requestedImages).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cards = await page.locator(".canvas-list-card").evaluateAll((nodes) => nodes.map((node) => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })));
    expect(new Set(cards.map((card) => Math.round(card.x))).size).toBe(width === 390 ? 1 : 3);
    await page.screenshot({ path: testInfo.outputPath(`canvas-list-${width}.png`), fullPage: true, animations: "disabled" });
    await page.evaluate(() => {
      localStorage.setItem("organize-theme", "dark");
      window.dispatchEvent(new CustomEvent("organize:theme-mode-change"));
    });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: testInfo.outputPath(`canvas-list-${width}-dark.png`), fullPage: true, animations: "disabled" });
    await page.evaluate(() => {
      localStorage.setItem("organize-theme", "light");
      window.dispatchEvent(new CustomEvent("organize:theme-mode-change"));
    });
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    const search = page.getByRole("searchbox", { name: "搜索画布标题和摘要" });
    await search.fill("秋日"); await expect(page.locator(".canvas-list-card")).toHaveCount(2);
    await search.fill("没有这个关键词"); await expect(page.getByText("没有匹配的画布")).toBeVisible();
    await page.getByRole("button", { name: "清除搜索", exact: true }).click();
    await expect(page.locator(".canvas-list-card")).toHaveCount(5);
    await page.getByRole("button", { name: "画布排序：最近修改" }).click();
    await page.getByRole("menuitemradio", { name: "标题", exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem("organize-canvas-list-sort"))).toBe("title");

    const card = page.locator(".canvas-list-card").filter({ has: page.getByRole("button", { name: "画布操作：阅读计划", exact: true }) });
    await card.getByRole("button", { name: "画布操作：阅读计划", exact: true }).click();
    await page.getByRole("menuitem", { name: "移入垃圾箱", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(card).toHaveCount(1);
    await card.locator(".canvas-list-open").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas\/.+/);
    await page.getByRole("link", { name: "返回画布列表" }).click();
    await expect(page.getByRole("button", { name: "画布排序：标题" })).toBeVisible();
  });
}
