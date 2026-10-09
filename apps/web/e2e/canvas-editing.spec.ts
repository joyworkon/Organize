import { expect, test, type Page } from "@playwright/test";

async function openCanvas(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
}

async function createPage(page: Page) {
  await page.getByRole("button", { name: "新建空白页面" }).click();
  await expect(page.locator("[data-block-id] textarea")).toBeFocused();
}

test("增列保留区块归属和模块边框，预览等于实际插入位置", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  await page.locator("[data-block-id] textarea").fill("同一区块内的内容");
  const region = page.locator("[data-region-id]");
  const regionId = await region.getAttribute("data-region-id");
  const first = page.locator("[data-block-id]").first();
  await first.hover();
  const textBox = (await first.locator("textarea").boundingBox())!;
  for (const control of await page.locator(".canvas-section .canvas-plus").all()) {
    const rect = (await control.boundingBox())!;
    const overlap = Math.min(rect.x + rect.width, textBox.x + textBox.width) > Math.max(rect.x, textBox.x)
      && Math.min(rect.y + rect.height, textBox.y + textBox.height) > Math.max(rect.y, textBox.y);
    expect(overlap).toBe(false);
  }
  const plus = page.getByRole("button", { name: "在右侧添加一列", exact: true });
  await plus.hover();
  const ghost = await page.locator(".canvas-insert-preview").boundingBox();
  expect(ghost).not.toBeNull();
  await plus.click();
  await expect(region.locator("[data-block-id]")).toHaveCount(2);
  await expect(region).toHaveAttribute("data-region-id", regionId!);
  const created = region.locator("[data-block-id]").last();
  await expect(created.locator("textarea")).toBeFocused();
  const actual = (await created.boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(actual[key] - ghost![key])).toBeLessThan(1);
  await page.getByRole("textbox", { name: "画布名称", exact: true }).focus();
  await page.mouse.move(0, 0);
  const border = await first.evaluate((el) => getComputedStyle(el).borderColor);
  expect(border).not.toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await first.hover();
  await expect.poll(() => first.evaluate((el) => getComputedStyle(el).borderColor)).toBe("rgba(0, 0, 0, 0)");
});

test("加号支持键盘激活，一次操作只新增一列/一块/一行", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  const first = page.locator("[data-block-id]").first();
  await first.hover();
  const right = page.getByRole("button", { name: "在右侧添加一列", exact: true });
  await right.focus();
  await right.press("Enter");
  await expect(page.locator("[data-column-id]")).toHaveCount(2);
  await expect(page.locator("[data-block-id] textarea")).toBeFocused();
  await first.hover();
  const below = page.getByRole("button", { name: "在本列下方添加模块", exact: true });
  await below.focus();
  await below.press("Enter");
  await expect(page.locator("[data-block-id]")).toHaveCount(3);
  await first.hover();
  const row = page.getByRole("button", { name: "添加通栏", exact: true });
  await expect(row).toHaveText("添加整行");
  await row.focus();
  await row.press("Enter");
  await expect(page.locator("[data-section-id]")).toHaveCount(2);
  await expect(page.locator("[data-region-id]")).toHaveCount(1);
});

test("区块入口不遮挡模块底部加号，鼠标可在当前列连续加块", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  const first = page.locator("[data-block-id]").first();
  await first.hover();
  await page.getByRole("button", { name: "在右侧添加一列", exact: true }).click();
  await first.hover();
  const below = page.getByRole("button", { name: "在本列下方添加模块", exact: true });
  await below.hover();
  const ghost = (await page.locator(".canvas-insert-preview").boundingBox())!;
  await below.click();
  await expect(page.locator("[data-region-id]")).toHaveCount(1);
  await expect(page.locator("[data-column-id]")).toHaveCount(2);
  await expect(page.locator("[data-block-id]")).toHaveCount(3);
  const added = page.locator("[data-column-id]").first().locator("[data-block-id]").last();
  const box = (await added.boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(box[key] - ghost[key])).toBeLessThan(1);
  await expect(added.locator("textarea")).toBeFocused();
});

test("只有一个区块也能添加独立区块，预览和新增外框一致", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  await page.locator("[data-block-id] textarea").fill("原区块");
  const gap = page.locator(".canvas-region-gap").last();
  await gap.hover();
  const button = gap.getByRole("button", { name: "在下方添加区块", exact: true });
  await expect(button).toContainText("区块");
  const preview = (await page.locator(".canvas-region-insert-preview").boundingBox())!;
  await button.focus();
  await button.press("Enter");
  await expect(page.locator("[data-region-id]")).toHaveCount(2);
  const original = page.locator("[data-region-id]").first();
  const added = page.locator("[data-region-id]").last();
  await expect(original.locator("[data-block-id]")).toHaveCount(1);
  await expect(added.locator("textarea")).toBeFocused();
  const box = (await added.boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(box[key] - preview[key])).toBeLessThan(1);
});

test("新建和适合全部避开面板，缩放控件可点击", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  await expect(page.getByRole("button", { name: "快速新建", exact: true })).toHaveCount(0);
  const editor = page.locator("[data-block-id] textarea");
  const left = await page.locator(".canvas-add-panel-wrap").boundingBox();
  const initial = await editor.boundingBox();
  expect(initial!.x).toBeGreaterThan(left!.x + left!.width);
  await editor.fill("在可用区域内编辑");
  await page.getByRole("button", { name: "适合全部" }).click();
  const board = await page.locator("[data-board-id]").boundingBox();
  const right = await page.locator(".canvas-property-bar").boundingBox();
  expect(board!.x).toBeGreaterThan(left!.x + left!.width);
  expect(board!.x + board!.width).toBeLessThan(right!.x);
});

test("列表长行和尾部空项按实际内容宽测高，输入与展示不裁切", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  await page.getByRole("button", { name: "添加列表" }).click();
  const block = page.locator("[data-text-role='list']");
  const textarea = block.locator("textarea");
  await textarea.fill("一个需要自动折行的列表项目。".repeat(12) + "\n\n");
  const metrics = await textarea.evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.height + 1);
  const before = await block.boundingBox();
  await page.getByRole("textbox", { name: "画布名称", exact: true }).focus();
  expect(await block.boundingBox()).toEqual(before);
  const overflow = await block.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const last = el.querySelector(".canvas-list-line:last-child")!.getBoundingClientRect();
    const scale = box.width / parseFloat((el as HTMLElement).style.width);
    return (last.bottom - box.bottom) / scale;
  });
  expect(overflow).toBeLessThanOrEqual(-12);
});

test("区块内边距只生效一次，区块名称不覆盖第一行内容", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  await page.locator("[data-block-id] textarea").fill("区块内边距核对");
  const region = page.locator("[data-region-id]");
  await region.dispatchEvent("pointerdown", { button: 0 });
  await page.getByRole("spinbutton", { name: "区块内边距" }).fill("32");
  const r = (await region.boundingBox())!;
  const scale = r.width / Number(await region.evaluate((el) => parseFloat((el as HTMLElement).style.width)));
  const b = (await region.locator("[data-block-id]").boundingBox())!;
  const label = (await region.locator("[data-region-name]").boundingBox())!;
  expect((b.x - r.x) / scale).toBeCloseTo(32, 1);
  expect((b.y - r.y) / scale).toBeCloseTo(32, 1);
  expect((r.x + r.width - b.x - b.width) / scale).toBeCloseTo(32, 1);
  expect(label.y + label.height).toBeLessThan(b.y);
});

test("保存在途时继续输入：串行补发最新 revision，状态与持久内容一致", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  await page.evaluate(() => {
    const original = window.fetch;
    const state = window as typeof window & { canvasPatchCount: number };
    state.canvasPatchCount = 0;
    window.fetch = async (...args) => {
      if (String(args[0]).includes("/api/canvases/") && args[1]?.method === "PATCH") {
        state.canvasPatchCount++;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      return original(...args);
    };
  });
  const textarea = page.locator("[data-block-id] textarea");
  await textarea.fill("旧快照");
  await expect(page.getByTestId("canvas-save-status")).toContainText("保存中");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { canvasPatchCount: number }).canvasPatchCount)).toBe(1);
  await textarea.fill("请求期间继续输入的新内容");
  await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
  const id = page.url().split("/").pop()!;
  const saved = await page.evaluate(async (id) => (await fetch(`/api/canvases/${id}`)).json(), id);
  expect(saved.content.boards[0].regions[0].sections[0].columns[0].blocks[0].text).toBe("请求期间继续输入的新内容");
  expect(saved.revision).toBeGreaterThanOrEqual(3);
});

test("智能图文比例只在编辑结束重算，手动列宽不被覆盖", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  await page.getByRole("button", { name: "插入模板：图文介绍" }).click();
  const region = page.locator("[data-region-id]").nth(1);
  const text = region.locator("[data-block-type='text']");
  await region.locator("[data-block-type='image']").click();
  await page.getByLabel("选择替换图片").setInputFiles({
    name: "ratio.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
  });
  await expect(region.locator("img")).toBeVisible();
  await text.dblclick();
  await text.locator("textarea").fill("短文");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "智能", exact: true }).click();
  const width = () => text.evaluate((el) => parseFloat((el as HTMLElement).style.width));
  const initial = await width();
  await text.dblclick();
  await text.locator("textarea").fill("需要更高版面的图文正文\n".repeat(20));
  expect(await width()).toBe(initial);
  await region.locator("[data-block-type='image']").click({ position: { x: 20, y: 24 } });
  await expect.poll(width).toBeLessThan(initial - 10);
  await page.getByRole("button", { name: "1:2", exact: true }).click();
  const manual = await width();
  await page.getByRole("button", { name: "适合全部" }).click();
  await text.dblclick({ position: { x: 20, y: 24 } });
  await text.locator("textarea").fill("改回短文");
  await page.keyboard.press("Escape");
  expect(await width()).toBe(manual);
});

for (const zoom of [0.5, 1, 2]) {
  test(`多行多列在 ${zoom * 100}% 缩放下保持区块坐标及输入内容归属`, async ({ page }) => {
    await openCanvas(page);
    await createPage(page);
    await page.locator("[data-block-id] textarea").fill("标题");
    await page.keyboard.press("Enter");
    await page.locator("[data-block-id] textarea").fill("正文");
    await page.locator("[data-block-id]").last().hover();
    await page.getByRole("button", { name: "在右侧添加一列" }).click();
    await page.locator("[data-block-id] textarea").fill("右列独立内容");
    await page.getByRole("button", { name: "添加正文" }).click();
    await page.locator("[data-block-id] textarea").fill("右列下一块\n更多正文");
    await page.getByRole("textbox", { name: "画布名称", exact: true }).focus();
    // 通过真实缩放控件改比例，随后直接检查屏幕矩形与局部坐标。
    await page.getByRole("button", { name: "100%", exact: true }).click();
    if (zoom !== 1) {
      const control = page.getByRole("button", { name: zoom < 1 ? "缩小" : "放大", exact: true });
      for (let i = 0; i < 4; i++) await control.click();
    }
    const geometry = await page.locator("[data-region-id]").evaluate((region) => {
      const r = region.getBoundingClientRect();
      const scale = r.width / parseFloat((region as HTMLElement).style.width);
      return Array.from(region.querySelectorAll("[data-block-id]")).map((el) => {
        const b = el.getBoundingClientRect();
        return { x: (b.x - r.x) / scale, y: (b.y - r.y) / scale,
          bottom: (b.bottom - r.bottom) / scale, right: (b.right - r.right) / scale };
      });
    });
    expect(geometry[0].x).toBeCloseTo(16, 1);
    expect(geometry[0].y).toBeCloseTo(16, 1);
    for (const b of geometry) {
      expect(b.x).toBeGreaterThanOrEqual(-0.1);
      expect(b.bottom).toBeLessThanOrEqual(0.1);
      expect(b.right).toBeLessThanOrEqual(0.1);
    }
    const id = page.url().split("/").pop()!;
    await expect(page.getByTestId("canvas-save-status")).toContainText("已保存");
    const saved = await page.evaluate(async (id) => (await fetch(`/api/canvases/${id}`)).json(), id);
    const blocks = saved.content.boards[0].regions[0].sections[1].columns;
    expect(blocks[0].blocks[0].text).toBe("正文");
    expect(blocks[1].blocks.map((b: { text: string }) => b.text)).toEqual(["右列独立内容", "右列下一块\n更多正文"]);
  });
}

test("页面→区块→行只应用一次偏移，多区块内容不越界", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "新建宣传落地页骨架" }).click();
  await page.locator("[data-block-id] textarea").fill("布局核对");
  await page.getByRole("button", { name: "适合全部" }).click();
  const geometry = await page.locator("[data-board-id]").evaluate((board) => {
    const b = board.getBoundingClientRect();
    const zoom = b.width / parseFloat((board as HTMLElement).style.width);
    return Array.from(board.querySelectorAll("[data-region-id]")).map((region) => {
      const r = region.getBoundingClientRect();
      const block = region.querySelector("[data-block-id]")!.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(region).paddingLeft);
      return {
        dx: (block.left - r.left) / zoom,
        dy: (block.top - r.top) / zoom,
        right: (block.right - r.right) / zoom,
        bottom: (block.bottom - r.bottom) / zoom,
        pad,
      };
    });
  });
  for (const g of geometry) {
    expect(g.dx).toBeCloseTo(g.pad, 1);
    expect(g.dy).toBeCloseTo(g.pad, 1);
    expect(g.right).toBeLessThanOrEqual(0.2);
    expect(g.bottom).toBeLessThanOrEqual(0.2);
  }
});

test("输入态与展示态字号、行高、颜色、对齐及换行位置一致", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  const block = page.locator("[data-block-id]").first();
  await block.locator("textarea").fill("标题输入与展示对齐");
  await page.locator(".canvas-property-bar").getByRole("radio", { name: "居中", exact: true }).first().click();
  await page.getByRole("radio", { name: "文字色：红", exact: true }).click();
  const styleOf = () => block.locator(".canvas-text-content").evaluate((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return [s.fontSize, s.lineHeight, s.fontWeight, s.textAlign, s.color, r.x, r.y, r.width];
  });
  const displayed = await styleOf();
  await block.dblclick();
  await expect(block.locator("textarea")).toBeFocused();
  expect(await styleOf()).toEqual(displayed);
});

test("Shift+Enter 末尾空行有足够输入高度，退出后容器不跳动", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  const block = page.locator("[data-block-id]").first();
  const textarea = block.locator("textarea");
  await textarea.fill("第一行");
  await textarea.press("End");
  await textarea.press("Shift+Enter");
  await expect(textarea).toHaveValue("第一行\n");
  const metrics = await textarea.evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollHeight,
    line: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(metrics.height).toBeGreaterThanOrEqual(Math.floor(metrics.line * 2));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.height + 1);
  const before = await block.boundingBox();
  await page.getByRole("textbox", { name: "画布名称", exact: true }).focus();
  const after = await block.boundingBox();
  expect(after).toEqual(before);
});

test("自由文本多行输入保持全宽、完整高度及展示样式", async ({ page }) => {
  await openCanvas(page);
  await page.getByRole("button", { name: "自由放置", exact: true }).click();
  await page.getByRole("button", { name: "新建自由文本" }).click();
  const item = page.locator("[data-free-item-id]");
  const textarea = item.locator("textarea");
  await expect(textarea).toBeFocused();
  await textarea.fill("第一行\n第二行\n第三行\n");
  const metrics = await textarea.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    expectedWidth: el.parentElement!.getBoundingClientRect().width - 26,
    height: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(metrics.width).toBeCloseTo(metrics.expectedWidth, 1);
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.height + 1);
  const before = await item.boundingBox();
  await page.getByRole("textbox", { name: "画布名称", exact: true }).focus();
  expect(await item.boundingBox()).toEqual(before);
});

test("Esc 退出文本编辑，Enter 新块后撤销重做恢复选中和输入焦点", async ({ page }) => {
  await openCanvas(page);
  await createPage(page);
  const titleId = await page.locator("[data-block-id]").getAttribute("data-block-id");
  await page.locator("[data-block-id] textarea").fill("标题");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-block-id] textarea")).toHaveCount(0);
  await page.locator(`[data-block-id='${titleId}']`).press("Enter");
  await expect(page.locator("[data-block-id] textarea")).toBeFocused();
  await page.keyboard.press("Enter");
  const bodyId = await page.locator(".canvas-block.is-editing").getAttribute("data-block-id");
  await page.keyboard.press("Meta+z");
  await expect(page.locator(`[data-block-id='${titleId}']`)).toHaveClass(/is-selected/);
  await expect(page.locator(`[data-block-id='${titleId}'] textarea`)).toBeFocused();
  await page.keyboard.press("Meta+Shift+z");
  await expect(page.locator(`[data-block-id='${bodyId}']`)).toHaveClass(/is-selected/);
  await expect(page.locator(`[data-block-id='${bodyId}'] textarea`)).toBeFocused();
});
