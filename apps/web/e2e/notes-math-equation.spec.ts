import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copiedMath: string }).copiedMath = value; } } });
    if (localStorage.getItem("math-controls-seeded")) return;
    localStorage.setItem("math-controls-seeded", "1");
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify([{
      op_id: "math-controls", created_at: Date.now(), note: {
        id: "e2e-math-controls", user_id: "mock-user-0001", title: "公式编辑验证",
        content: { type: "doc", content: [
          { type: "mathBlock", attrs: { latex: "E=mc^2" } },
          { type: "paragraph", content: [{ type: "text", text: "前文" }, { type: "inlineMath", attrs: { latex: "x^2" } }, { type: "text", text: "后文" }] },
          { type: "paragraph" },
        ] },
      },
    }]));
  });
  await page.goto("/notes/e2e-math-controls");
  await expect(page.locator(".math-block")).toBeVisible();
}

for (const width of [390, 1440]) {
  test(`formula editing, preview, toolbar and undo fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 }); await seed(page);
    const editor = page.locator(".tiptap.organize-editor");
    const dialog = page.getByRole("dialog");
    await page.locator(".math-block .organize-math-anchor").click();
    await expect(dialog).toBeVisible();
    const source = dialog.getByLabel("LaTeX 源码");
    await expect(source).toHaveValue("E=mc^2");
    await source.fill("\\frac{a}{b}");
    await expect(dialog.getByRole("region", { name: "公式实时预览" }).locator(".katex")).toBeVisible();
    await source.fill("\\frac{"); await expect(dialog).toContainText("公式语法有误");
    await source.fill(""); await expect(dialog).toContainText("输入公式后在此预览");
    await source.fill("a^2+b^2=c^2");
    await page.screenshot({ path: testInfo.outputPath(`math-dialog-${width}.png`) });
    await source.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(page.locator(".math-block")).toHaveAttribute("data-latex", "E=mc^2");
    const toolbar = page.getByRole("group", { name: "公式工具栏" });
    await expect(toolbar).toBeVisible();
    await expect(page.locator(".organize-bubble-toolbar:visible")).toHaveCount(0);
    await toolbar.getByRole("button", { name: "编辑公式", exact: true }).click();
    await source.fill("a^2+b^2=c^2"); await source.press("ControlOrMeta+Enter");
    await expect(dialog).toHaveCount(0); await expect(page.locator(".math-block")).toHaveAttribute("data-latex", "a^2+b^2=c^2");
    await toolbar.getByRole("button", { name: "复制 LaTeX" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { copiedMath: string }).copiedMath)).toBe("a^2+b^2=c^2");
    await toolbar.getByRole("button", { name: "转为行内公式" }).click();
    await expect(page.locator('.math-inline[data-latex="a^2+b^2=c^2"]')).toBeVisible();
    await editor.press("ControlOrMeta+z"); await expect(page.locator(".math-block")).toBeVisible();
    await editor.press("Enter"); await expect(dialog).toBeVisible(); await source.press("Escape");
    await editor.press("ControlOrMeta+e"); await expect(dialog).toBeVisible(); await source.press("Escape");
    await toolbar.getByRole("button", { name: "删除公式" }).click(); await expect(page.locator(".math-block")).toHaveCount(0);
    await editor.press("ControlOrMeta+z"); await expect(page.locator(".math-block")).toBeVisible();
    await page.locator('.math-inline[data-latex="x^2"] .organize-math-anchor').click(); await source.press("Escape");
    await toolbar.getByRole("button", { name: "转为公式区块" }).click();
    await expect(page.locator('.math-block[data-latex="x^2"]')).toBeVisible();
    await expect(editor).toContainText("前文"); await expect(editor).toContainText("后文");
    await page.screenshot({ path: testInfo.outputPath(`math-toolbar-${width}.png`) });
    if (width === 1440) {
      await page.evaluate(() => { localStorage.setItem("organize-theme", "dark"); window.dispatchEvent(new CustomEvent("organize:theme-mode-change")); });
      await expect(toolbar).toHaveCSS("color", "rgb(238, 238, 238)");
      await toolbar.getByRole("button", { name: "编辑公式", exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath("math-dialog-dark.png") }); await source.press("Escape");
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await editor.press("ControlOrMeta+z"); await expect(page.locator('.math-inline[data-latex="x^2"]')).toBeVisible();
  });
}

test("slash cancellation preserves the trigger and document", async ({ page }) => {
  await seed(page);
  const editor = page.locator(".tiptap.organize-editor"), dialog = page.getByRole("dialog");
  await editor.locator(":scope > p").last().click();
  await page.keyboard.type("/math");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("LaTeX 源码").fill("discarded");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toContainText("/math");
  await expect(page.locator(".math-block")).toHaveCount(1);
});

test("slash saves a new formula through the preview dialog", async ({ page }) => {
  await seed(page);
  const editor = page.locator(".tiptap.organize-editor"), dialog = page.getByRole("dialog");
  await editor.locator(":scope > p").last().click();
  await page.keyboard.type("/math"); await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("LaTeX 源码").fill("\\sqrt{x}");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".math-block").last()).toHaveAttribute("data-latex", "\\sqrt{x}");
  await expect(page.locator(".math-block").last().locator(".katex")).toBeVisible();
  await expect(editor).not.toContainText("/math");
});

test("text bubble inserts inline and block formulas using the same editor", async ({ page }) => {
  await seed(page);
  const editor = page.locator(".tiptap.organize-editor"), dialog = page.getByRole("dialog");
  async function selectText() {
    await editor.locator(":scope > p").first().evaluate((paragraph) => {
      const text = paragraph.firstChild!;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 2);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      (paragraph.closest('[contenteditable="true"]') as HTMLElement).focus();
      document.dispatchEvent(new Event("selectionchange"));
    });
  }
  await selectText();
  const bubble = page.locator(".organize-bubble-toolbar:visible");
  await bubble.getByRole("button", { name: "行内公式", exact: true }).click();
  await dialog.getByLabel("LaTeX 源码").fill("y^2"); await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator('.math-inline[data-latex="y^2"]')).toBeVisible();
  await editor.press("ControlOrMeta+z");
  await selectText(); await bubble.getByRole("button", { name: "文本", exact: true }).click();
  await page.getByRole("button", { name: "公式区块", exact: true }).click();
  await expect(dialog).toBeVisible(); await dialog.getByLabel("LaTeX 源码").fill("z^2");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator('.math-block[data-latex="z^2"]')).toBeVisible();
  await expect(editor).toContainText("后文");
});

test("nested slash inserts into a list without replacing surrounding content", async ({ page }) => {
  await seed(page);
  const editor = page.locator(".tiptap.organize-editor"), dialog = page.getByRole("dialog");
  await editor.locator(":scope > p").last().click();
  await page.keyboard.type("- /math"); await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("LaTeX 源码").fill("x+y");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editor.locator('li .math-block')).toHaveAttribute("data-latex", "x+y");
  await expect(editor).toContainText("前文"); await expect(editor).toContainText("后文");
  await expect(editor).not.toContainText("/math");
});
