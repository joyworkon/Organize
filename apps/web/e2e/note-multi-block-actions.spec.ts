import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify([{
      op_id: "multi-block-actions", created_at: Date.now(), note: {
        id: "e2e-multi-block-actions", user_id: "mock-user-0001", title: "多选块工具栏",
        content: { type: "doc", content: ["第一块", "第二块", "第三块", "第四块"].map((text, index) => ({ type: "paragraph", attrs: { id: `multi-${index}` }, content: [{ type: "text", text }] })) },
      },
    }]));
  });
  await page.goto("/notes/e2e-multi-block-actions");
  await expect(page.locator(".tiptap.organize-editor")).toContainText("第四块");
}

async function selectFirstTwo(page: Page) {
  const paragraphs = page.locator(".tiptap.organize-editor > p");
  // Real marquee gesture starts in blank space to the right of the text.
  const first = await paragraphs.nth(0).boundingBox();
  const second = await paragraphs.nth(1).boundingBox();
  if (!first || !second) throw new Error("Missing paragraph bounds");
  await page.mouse.move(first.x + first.width - 12, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 12, second.y + second.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("group", { name: "多选块操作", exact: true })).toContainText("已选 2 个块");
  await expect(page.locator(".organize-block-selected")).toHaveCount(2);
}

for (const width of [390, 1440]) {
  test(`multi-block toolbar converts, colors, moves and wraps at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await seed(page); await selectFirstTwo(page);
    const editor = page.locator(".tiptap.organize-editor");
    const toolbar = page.getByRole("group", { name: "多选块操作", exact: true });
    const transform = toolbar.getByRole("button", { name: "转换成", exact: true });
    if (width === 1440) {
      await transform.focus(); await transform.press("Enter");
      await page.keyboard.press("Escape");
      await expect(transform).toBeFocused();
      await expect(page.locator(".organize-block-selected")).toHaveCount(2);
      await transform.press("Enter");
    } else await transform.click();
    const heading = page.getByRole("button", { name: "标题 2", exact: true });
    if (width === 1440) { await heading.focus(); await heading.press("Enter"); }
    else await heading.click();
    await expect(editor.locator(":scope > h2")).toHaveCount(2);
    await expect(editor.locator(":scope > h2").first()).toHaveAttribute("data-id", "multi-0");
    await expect(page.locator(".organize-block-selected")).toHaveCount(2);
    // Focus via keyboard rather than clicking the document, which intentionally clears selection.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor.locator(":scope > h2")).toHaveCount(0);
    await selectFirstTwo(page);
    await toolbar.getByRole("button", { name: "颜色", exact: true }).click();
    await page.getByRole("button", { name: "背景颜色：蓝色背景", exact: true }).click();
    await expect(editor.locator("[data-block-background]")).toHaveCount(2);
    await toolbar.getByRole("button", { name: "下移多选块", exact: true }).click();
    await expect(editor.locator(":scope > p").first()).toHaveText("第三块");
    await expect(page.locator(".organize-block-selected")).toHaveCount(2);
    await toolbar.getByRole("button", { name: "包裹", exact: true }).click();
    await page.getByRole("button", { name: "标注", exact: true }).click();
    await expect(editor.locator("[data-callout]")).toContainText("第一块第二块");
    await expect(page.locator(".organize-block-selected")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "包裹选项", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`multi-block-${width}.png`) });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await toolbar.getByRole("button", { name: "取消块多选", exact: true }).click();
    await expect(toolbar).toHaveCount(0);
  });
}
