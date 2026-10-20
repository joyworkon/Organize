import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page) {
  // Local SVG data keeps image loading deterministic, including natural-size viewer checks.
  const src = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#626262"/><text x="100" y="200" fill="white" font-size="80">Image controls</text></svg>').toString("base64")}`;
  await page.addInitScript(({ src }) => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    if (localStorage.getItem("image-controls-seeded")) return;
    localStorage.setItem("image-controls-seeded", "1");
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify([{
      op_id: "image-controls", created_at: Date.now(), note: {
        id: "e2e-image-controls", user_id: "mock-user-0001", title: "图片工具栏验证",
        content: { type: "doc", content: [{ type: "image", attrs: { src, alt: "示例说明", width: 320 } }, { type: "paragraph", content: [{ type: "text", text: "图片后的正文保持可编辑" }] }] },
      },
    }]));
  }, { src });
  await page.goto("/notes/e2e-image-controls");
  await expect(page.locator(".organize-image img")).toBeVisible();
}

for (const width of [320, 390, 768, 1440]) {
  test(`image controls and viewer fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 }); await seed(page);
    const image = page.locator(".organize-image img"), frame = page.locator(".organize-image-frame");
    await image.click();
    const toolbar = page.getByRole("group", { name: "图片工具栏", exact: true });
    await expect(toolbar).toBeVisible();
    await expect(page.locator(".organize-image-resizer")).toHaveCount(2);
    await page.getByRole("button", { name: "50%", exact: true }).click();
    await expect(page.getByRole("button", { name: "50%", exact: true })).toHaveAttribute("aria-pressed", "true");
    const handle = page.locator('.organize-image-resizer[data-side="left"]');
    await handle.focus(); await handle.press("Home"); await expect(handle).toHaveAttribute("aria-valuenow", "96");
    await handle.press("Shift+ArrowRight"); await expect(handle).toHaveAttribute("aria-valuenow", "160");
    await handle.press("ControlOrMeta+z"); await expect(handle).toHaveAttribute("aria-valuenow", "96");
    await page.getByRole("button", { name: "自适应", exact: true }).click();
    await expect(frame).not.toHaveAttribute("style", /width/);
    await page.screenshot({ path: testInfo.outputPath(`image-toolbar-${width}.png`) });
    if (width === 1440) {
      await page.evaluate(() => {
        localStorage.setItem("organize-theme", "dark");
        window.dispatchEvent(new CustomEvent("organize:theme-mode-change"));
      });
      await expect(toolbar).toHaveCSS("color", "rgb(238, 238, 238)");
      await expect(page.getByRole("button", { name: "50%", exact: true })).toHaveCSS("color", "rgb(238, 238, 238)");
      await page.screenshot({ path: testInfo.outputPath("image-toolbar-dark.png") });
    }
    await page.getByRole("button", { name: "查看大图", exact: true }).click();
    const viewer = page.getByRole("dialog", { name: "图片查看器" });
    await expect(viewer).toBeVisible(); await expect(viewer).toContainText("示例说明");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(viewer).toHaveCSS("animation-name", "none");
    await expect(viewer).toHaveCSS("transform", "none");
    await expect.poll(async () => { const box = await viewer.boundingBox(); return box && { x: box.x, y: box.y, width: Math.round(box.width), height: Math.round(box.height) }; }).toEqual({ x: 0, y: 0, width, height: 900 });
    for (const control of await viewer.locator("button").all()) {
      await expect(control).toHaveCSS("color", "rgb(255, 255, 255)");
      await expect.poll(() => control.evaluate((element) => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); })).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`image-viewer-${width}.png`), animations: "disabled" });
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await expect(page.locator(".organize-image-viewer-stage")).toHaveAttribute("data-scale", "1");
    await page.getByRole("button", { name: "缩小图片", exact: true }).click();
    await expect(page.locator(".organize-image-viewer-stage")).toHaveAttribute("data-scale", "0.8");
    await page.keyboard.press("Escape"); await expect(viewer).toHaveCount(0); await expect(frame).toBeFocused();
    await image.dblclick(); await expect(viewer).toBeVisible();
    // Click an empty top corner of the stage rather than the image.
    await page.locator(".organize-image-viewer-stage").click({ position: { x: 1, y: 1 } }); await expect(viewer).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("image alt and deletion use undoable transactions in the real NodeView", async ({ page }) => {
  await seed(page); await page.locator(".organize-image img").click();
  await page.getByRole("button", { name: "替代文字", exact: true }).click();
  await page.getByLabel("替代文字", { exact: true }).fill("更新的图片说明"); await page.getByLabel("替代文字", { exact: true }).press("Enter");
  await expect(page.locator(".organize-image img")).toHaveAttribute("alt", "更新的图片说明");
  await page.getByRole("button", { name: "更多图片操作" }).click(); await page.getByRole("menuitem", { name: "删除图片" }).click();
  await expect(page.locator(".organize-image")).toHaveCount(0);
  await page.locator(".tiptap.organize-editor").press("ControlOrMeta+z");
  await expect(page.locator(".organize-image img")).toHaveAttribute("alt", "更新的图片说明");
  await page.locator(".tiptap.organize-editor").press("ControlOrMeta+z"); await expect(page.locator(".organize-image img")).toHaveAttribute("alt", "示例说明");
});
