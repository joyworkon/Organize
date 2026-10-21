import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page, merged: boolean) {
  await page.addInitScript(({ merged }) => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    if (localStorage.getItem("column-resize-seeded")) return;
    localStorage.setItem("column-resize-seeded", "1");
    const cell = (text: string, colspan = 1) => ({
      type: "tableCell", attrs: { colspan },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify([{
      op_id: "column-resize", created_at: Date.now(), note: {
        id: "e2e-column-resize", user_id: "mock-user-0001", title: "表格列宽调整",
        content: { type: "doc", content: [{
          type: "table", content: [
            { type: "tableRow", content: merged ? [cell("合并单元格", 2), cell("最右列")] : [cell("第一列"), cell("第二列"), cell("最右列")] },
            { type: "tableRow", content: [cell("正文一"), cell("正文二"), cell("正文三")] },
          ],
        }, { type: "paragraph", content: [{ type: "text", text: "表格后的正文" }] }] },
      },
    }]));
  }, { merged });
  await page.goto("/notes/e2e-column-resize");
  await expect(page.locator(".tiptap.organize-editor table")).toContainText("正文三");
  await page.getByText("正文二", { exact: true }).click();
}

async function widths(page: Page) {
  return page.locator(".tiptap.organize-editor table > colgroup > col").evaluateAll(
    (columns) => columns.map((column) => Math.round(column.getBoundingClientRect().width))
  );
}

for (const width of [390, 1440]) {
  test.describe(`${width}px column resizing`, () => {
    test.use({ viewport: { width, height: 1000 }, hasTouch: width === 390 });
    for (const merged of [false, true]) {
      test(`drag, keyboard, cancel, equalize and reload (${merged ? "merged" : "regular"})`, async ({ page }, testInfo) => {
        await seed(page, merged);
        const table = page.locator(".tiptap.organize-editor table");
        const last = page.getByRole("separator", { name: "调整第 3 列宽度", exact: true });
        const first = page.getByRole("separator", { name: "调整第 1 列宽度", exact: true });
        const initial = await widths(page);
        const bounds = await last.boundingBox();
        if (!bounds) throw new Error("Missing last column handle");
        const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
        await expect(last).toHaveCSS("width", "12px");
        if (width === 390) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 20, y }] });
          await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(x, y); await page.mouse.down();
          await page.mouse.move(x + 30, y, { steps: 5 });
          await expect(table).not.toHaveAttribute("data-table-fixed-columns");
          await expect.poll(async () => (await widths(page))[2]).toBeGreaterThan(initial[2] + 20);
          await page.mouse.up();
        }
        await expect(table).toHaveAttribute("data-table-fixed-columns");
        const afterLast = await widths(page);
        expect(Math.abs(afterLast[0] - initial[0])).toBeLessThanOrEqual(2);
        expect(Math.abs(afterLast[2] - initial[2])).toBeGreaterThanOrEqual(18);
        await first.focus(); await first.press("ArrowRight");
        await expect.poll(async () => (await widths(page))[0]).toBe(afterLast[0] + 4);
        const beforeCancel = await widths(page);
        const firstBox = await first.boundingBox();
        if (!firstBox) throw new Error("Missing first column handle");
        await page.mouse.move(firstBox.x + 6, firstBox.y + 20); await page.mouse.down();
        await page.mouse.move(firstBox.x + 46, firstBox.y + 20, { steps: 5 });
        await page.keyboard.press("Escape"); await page.mouse.up();
        expect(await widths(page)).toEqual(beforeCancel);
        await expect(page.locator("style[data-organize-column-resize-preview]")).toHaveCount(0);
        await page.mouse.move(firstBox.x + 6, firstBox.y + 20); await page.mouse.down();
        await page.mouse.move(firstBox.x - 10, firstBox.y + 20, { steps: 4 }); await page.mouse.up();
        await expect.poll(async () => (await widths(page))[0]).toBe(beforeCancel[0] - 16);
        await first.focus(); await first.press("ArrowLeft");
        await page.screenshot({ path: testInfo.outputPath(`columns-${merged ? "merged" : "regular"}.png`) });
        if (width === 1440 && merged) {
          await page.evaluate(() => { localStorage.setItem("organize-theme", "dark"); window.dispatchEvent(new CustomEvent("organize:theme-mode-change")); });
          await page.screenshot({ path: testInfo.outputPath("columns-dark.png") });
        }
        const saved = await widths(page);
        // A reload exercises the existing local draft/JSON save path.
        await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((key) => key.includes("draft")))).toBe(true);
        await page.reload();
        await page.getByRole("button", { name: "恢复本地草稿", exact: true }).click();
        await expect(table).toHaveAttribute("data-table-fixed-columns");
        expect(await widths(page)).toEqual(saved);
        await page.getByText("正文二", { exact: true }).click();
        await page.getByRole("button", { name: "平均分布列宽", exact: true }).click();
        await expect(table).not.toHaveAttribute("data-table-fixed-columns");
        const equalized = await widths(page);
        expect(Math.max(...equalized) - Math.min(...equalized)).toBeLessThanOrEqual(1);
        await first.focus(); await first.press("ArrowRight");
        await expect(table).toHaveAttribute("data-table-fixed-columns");
        const wrapper = await page.locator(".tiptap.organize-editor .tableWrapper").boundingBox();
        expect(wrapper!.x + wrapper!.width).toBeLessThanOrEqual(width);
      });
    }
  });
}
