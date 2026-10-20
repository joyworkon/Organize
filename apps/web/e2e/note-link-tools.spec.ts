import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify([{
      op_id: "link-tools", created_at: Date.now(), note: {
        id: "e2e-link-tools", user_id: "mock-user-0001", title: "链接工具验证",
        content: { type: "doc", content: [
          { type: "paragraph", attrs: { id: "link-stable" }, content: [{ type: "text", text: "外部链接", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
          { type: "paragraph", content: [{ type: "text", text: "内部笔记", marks: [{ type: "link", attrs: { href: "/notes/note-1" } }] }] },
          { type: "paragraph", content: [{ type: "text", text: "选中文字保持不变" }] },
          { type: "paragraph" },
        ] },
      },
    }]));
  });
  await page.goto("/notes/e2e-link-tools");
  // Local next dev indicator otherwise covers the bottom-sheet open button; production has no overlay.
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await expect(page.locator(".tiptap.organize-editor")).toContainText("外部链接");
}

for (const width of [390, 1440]) {
  test(`link card and inline editor work at ${width}px without changing block IDs`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); await seed(page);
    const editor = page.locator(".tiptap.organize-editor"), link = editor.locator('a[href="https://example.com"]');
    const card = page.getByRole("group", { name: "链接卡片", exact: true });
    if (width === 1440) {
      const before = await page.evaluate(() => ({ text: getSelection()?.toString(), active: document.activeElement?.tagName }));
      await link.hover(); await expect(card).toBeVisible();
      expect(await page.evaluate(() => ({ text: getSelection()?.toString(), active: document.activeElement?.tagName }))).toEqual(before);
    } else { await link.click(); await expect(card).toBeVisible(); }
    await card.hover(); await expect(card).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`link-card-${width}-light.png`), animations: "disabled" });
    await card.getByRole("button", { name: "编辑", exact: true }).click();
    const input = page.getByRole("textbox", { name: "链接地址", exact: true });
    await expect(input).toBeFocused(); await expect(input).toHaveValue("https://example.com");
    await input.fill("javascript:alert(1)"); await input.press("Enter"); await expect(page.getByRole("form", { name: "编辑链接" }).getByRole("alert")).toContainText("请输入有效链接");
    await input.fill("example.org/path"); await input.press("Enter");
    const changed = editor.locator('a[href="https://example.org/path"]'); await expect(changed).toHaveText("外部链接");
    await expect(editor.locator('[data-id="link-stable"]')).toHaveText("外部链接");
    await changed.click(); await expect(card).toBeVisible();
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: testInfo.outputPath(`link-card-${width}-dark.png`), animations: "disabled" });
    await page.keyboard.press("Escape"); await expect(card).toHaveCount(0);
    await changed.click(); await card.getByRole("button", { name: "取消链接", exact: true }).click();
    await expect(editor.locator('a[href="https://example.org/path"]')).toHaveCount(0);
    await expect(editor.locator('[data-id="link-stable"]')).toHaveText("外部链接");
    await editor.locator('a[href="/notes/note-1"]').click(); await expect(card).toBeVisible();
    await expect(page).toHaveURL(/e2e-link-tools$/); // ordinary click previews; explicit open navigates.
    await card.getByRole("button", { name: "打开", exact: true }).click(); await expect(page).toHaveURL(/\/notes\/note-1$/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("selection paste preserves text; toolbar uses inline editing; bare URL paste/input link automatically; global command K still opens", async ({ page }) => {
  await seed(page);
  const editor = page.locator(".tiptap.organize-editor");
  const text = editor.locator(":scope > p").nth(2);
  await text.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    (element.closest('[contenteditable="true"]') as HTMLElement).focus();
    document.dispatchEvent(new Event("selectionchange"));
  });
  const toolbar = page.locator(".organize-bubble-toolbar");
  await expect(toolbar).toBeVisible(); await toolbar.getByRole("button", { name: "链接", exact: true }).click();
  const input = page.getByRole("textbox", { name: "链接地址", exact: true }); await expect(input).toBeVisible();
  await input.fill("example.org"); await input.press("Escape"); await expect(input).toHaveCount(0);
  await text.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    const data = new DataTransfer(); data.setData("text/plain", "https://paste.example.com");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(text.locator("a")).toHaveText("选中文字保持不变"); await expect(text.locator("a")).toHaveAttribute("href", "https://paste.example.com");
  const last = editor.locator(":scope > p").last();
  await last.evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(true);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    (element.closest('[contenteditable="true"]') as HTMLElement).focus();
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(toolbar).not.toBeVisible();
  await last.evaluate((element) => {
    const data = new DataTransfer(); data.setData("text/plain", "https://bare.example.com");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(last.locator("a")).toHaveAttribute("href", "https://bare.example.com");
  await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.keyboard.type("typed.example.com ");
  await expect(editor.locator('a[href="https://typed.example.com"]')).toBeVisible();
  // Existing global contract intentionally ignores typing targets; no editor override is added.
  await editor.evaluate((element: HTMLElement) => element.blur());
  await page.keyboard.press("ControlOrMeta+k"); await expect(page.getByRole("dialog")).toBeVisible();
});


test("image clipboard files keep priority over URL text", async ({ page }) => {
  await seed(page);
  const editor = page.locator(".tiptap.organize-editor");
  await editor.locator(":scope > p").last().click();
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File(["image-bytes"], "clipboard.png", { type: "image/png" }));
    data.setData("text/plain", "https://must-not-be-pasted.example.com");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(editor.locator(".organize-image img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(editor).not.toContainText("must-not-be-pasted");
});
