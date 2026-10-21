import { test, expect, type Page } from "@playwright/test";

const SEED_CODE = "graph TD\n  Start --> Finish";
const NEXT_CODE = "flowchart LR\n  Alpha --> Beta";

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copiedMermaid: string }).copiedMermaid = value; } } });
    if (localStorage.getItem("mermaid-controls-seeded")) return;
    localStorage.setItem("mermaid-controls-seeded", "1");
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify([{
      op_id: "mermaid-controls", created_at: Date.now(), note: {
        id: "e2e-mermaid-controls", user_id: "mock-user-0001", title: "Mermaid 图表编辑验证",
        content: { type: "doc", content: [
          { type: "mermaid", attrs: { code: "graph TD\n  Start --> Finish" } },
          { type: "paragraph", content: [{ type: "text", text: "正文" }] },
          { type: "paragraph" },
        ] },
      },
    }]));
  });
  await page.goto("/notes/e2e-mermaid-controls");
  await expect(page.locator(".organize-mermaid .organize-mermaid-preview svg")).toBeVisible();
}

for (const width of [390, 1440]) {
  test(`diagram live preview, toolbar, keyboard and undo fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 }); await seed(page);
    const editor = page.locator(".tiptap.organize-editor");
    const block = page.locator(".organize-mermaid");
    const diagram = block.locator(".organize-mermaid-preview svg");
    const dialog = page.getByRole("dialog");
    await expect(diagram).toContainText("Start");

    await block.getByRole("button", { name: "编辑源码", exact: true }).click();
    await expect(dialog).toBeVisible();
    const source = dialog.getByLabel("Mermaid 源码");
    const preview = dialog.getByRole("region", { name: "图表实时预览" });
    await expect(source).toHaveValue(SEED_CODE);
    await expect(preview.locator("svg")).toBeVisible();
    await source.fill(NEXT_CODE);
    await expect(preview).toContainText("Alpha");
    await source.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(source).toHaveValue(`${NEXT_CODE}\n`);
    await source.fill("boom");
    await expect(dialog).toContainText("图表语法有误");
    await expect(dialog).toContainText("首行似乎不是图表类型关键字");
    await expect(preview).toHaveAttribute("data-invalid", "true");
    await expect(preview.locator("svg")).toBeVisible();
    await expect(preview).toContainText("Alpha");
    await source.fill("");
    await expect(dialog).toContainText("输入源码后在此预览");
    await source.fill(NEXT_CODE);
    await expect(preview).toContainText("Alpha");
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`mermaid-dialog-${width}.png`) });
    await source.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(diagram).toContainText("Start");

    const toolbar = page.getByRole("group", { name: "图表工具栏" });
    await expect(toolbar).toBeVisible();
    await expect(page.locator(".organize-bubble-toolbar:visible")).toHaveCount(0);
    await toolbar.getByRole("button", { name: "编辑图表", exact: true }).click();
    await expect(source).toHaveValue(SEED_CODE);
    await source.fill(NEXT_CODE); await source.press("ControlOrMeta+Enter");
    await expect(dialog).toHaveCount(0);
    await expect(diagram).toContainText("Alpha");
    await toolbar.getByRole("button", { name: "复制图表源码" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { copiedMermaid: string }).copiedMermaid)).toBe(NEXT_CODE);
    await editor.press("ControlOrMeta+z"); await expect(diagram).toContainText("Start");
    await editor.press("Enter"); await expect(dialog).toBeVisible(); await source.press("Escape");
    await editor.press("ControlOrMeta+e"); await expect(dialog).toBeVisible(); await source.press("Escape");
    await block.locator(".organize-mermaid-preview").dblclick(); await expect(dialog).toBeVisible(); await source.press("Escape");
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`mermaid-toolbar-${width}.png`) });
    await toolbar.getByRole("button", { name: "删除图表", exact: true }).click(); await expect(block).toHaveCount(0);
    await editor.press("ControlOrMeta+z"); await expect(diagram).toContainText("Start");
    if (width === 1440) {
      await page.evaluate(() => { localStorage.setItem("organize-theme", "dark"); window.dispatchEvent(new CustomEvent("organize:theme-mode-change")); });
      await expect(toolbar).toHaveCSS("color", "rgb(238, 238, 238)");
      await toolbar.getByRole("button", { name: "编辑图表", exact: true }).click();
      await expect(preview.locator("svg")).toBeVisible();
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath("mermaid-dialog-dark.png") }); await source.press("Escape");
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("slash inserts a diagram whose strip opens the live editor and saves through the preview", async ({ page }) => {
  await seed(page);
  const editor = page.locator(".tiptap.organize-editor"), dialog = page.getByRole("dialog");
  await editor.locator(":scope > p").last().click();
  await page.keyboard.type("/mermaid"); await page.keyboard.press("Enter");
  const inserted = page.locator(".organize-mermaid").last();
  await expect(page.locator(".organize-mermaid")).toHaveCount(2);
  await expect(inserted.locator(".organize-mermaid-preview svg")).toBeVisible();
  await inserted.getByRole("button", { name: "编辑源码", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Mermaid 源码").fill("pie\n  \"Done\": 3\n  \"Todo\": 1");
  await expect(dialog.getByRole("region", { name: "图表实时预览" })).toContainText("Done");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inserted.locator(".organize-mermaid-preview svg")).toContainText("Done");
  await expect(page.locator(".organize-mermaid").first().locator(".organize-mermaid-preview svg")).toContainText("Start");
  await expect(editor).toContainText("正文");
});
