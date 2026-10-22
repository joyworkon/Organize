import { expect, test, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copiedFile: string }).copiedFile = value; } } });
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify([{
      op_id: "file-controls", created_at: Date.now(), note: {
        id: "e2e-file-controls", user_id: "mock-user-0001", title: "附件工具栏验证",
        content: { type: "doc", content: [{ type: "paragraph", attrs: { id: "file-insert" } }, { type: "paragraph", content: [{ type: "text", text: "附件后的正文" }] }] },
      },
    }]));
  });
  await page.goto("/notes/e2e-file-controls");
  await expect(page.locator(".tiptap.organize-editor")).toBeEditable();
  // Mock mode has a browser fetch shim, so stub its upload boundary after installation.
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => String(input) === "/api/upload"
      ? new Response(JSON.stringify({ url: "https://example.com/report.pdf", name: "report.pdf", size: 12, mime: "application/pdf" }), { headers: { "Content-Type": "application/json" } })
      : original(input, init);
  });
}

for (const width of [390, 1440]) {
  test(`slash attachment, toolbar, undo and readonly controls fit ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); await seed(page);
    const editor = page.locator(".tiptap.organize-editor");
    async function slash(query: string) {
      await editor.locator('p[data-id="file-insert"]').evaluate((element) => {
        const instance = (element.closest(".tiptap") as HTMLElement & { editor: Editor }).editor;
        instance.commands.setTextSelection(instance.view.posAtDOM(element, 0)); instance.view.focus();
      });
      await page.keyboard.type(`/${query}`);
      await expect(page.locator(".block-command-popover").getByRole("option", { name: /^附件/ })).toBeVisible();
      const picking = page.waitForEvent("filechooser");
      await page.locator(".block-command-popover").getByRole("option", { name: /^附件/ }).click();
      return picking;
    }
    const cancelled = await slash("file"); await cancelled.setFiles([]);
    await expect(editor.locator("[data-file-attachment]")).toHaveCount(0);
    const choosing = await slash("文件");
    await choosing.setFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("fake-pdf") });
    const attachment = editor.locator("[data-file-attachment]");
    await expect(attachment).toHaveCount(1); await expect(attachment).toContainText("report.pdf"); await expect(editor).toContainText("附件后的正文");
    await attachment.locator(".file-attachment-card").click();
    const toolbar = page.getByRole("group", { name: "附件工具栏", exact: true });
    await expect(toolbar).toBeVisible(); await expect(page.locator(".organize-bubble-toolbar:visible")).toHaveCount(0);
    await toolbar.getByRole("button", { name: "重命名附件", exact: true }).click();
    await page.getByLabel("附件名称", { exact: true }).fill("  项目资料.pdf  "); await page.getByLabel("附件名称", { exact: true }).press("Enter");
    await expect(attachment).toContainText("项目资料.pdf");
    await editor.press("ControlOrMeta+z"); await expect(attachment).toContainText("report.pdf");
    await attachment.locator(".file-attachment-card").click();
    await toolbar.getByRole("button", { name: "更多附件操作" }).click(); await page.getByRole("menuitem", { name: "删除附件", exact: true }).click();
    await expect(attachment).toHaveCount(0); await editor.press("ControlOrMeta+z"); await expect(attachment).toContainText("report.pdf");
    await attachment.locator(".file-attachment-card").click();
    await page.screenshot({ path: testInfo.outputPath(`file-toolbar-${width}-light.png`), animations: "disabled" });
    if (width === 1440) {
      await page.evaluate(() => { localStorage.setItem("organize-theme", "dark"); window.dispatchEvent(new CustomEvent("organize:theme-mode-change")); });
      await expect(toolbar).toHaveCSS("color", "rgb(238, 238, 238)");
      await page.screenshot({ path: testInfo.outputPath("file-toolbar-dark.png"), animations: "disabled" });
    }
    await editor.evaluate((element) => (element as HTMLElement & { editor: Editor }).editor.setEditable(false));
    await attachment.locator(".file-attachment-card").click();
    await expect(toolbar.getByRole("button", { name: "替换附件" })).toHaveCount(0); await expect(toolbar.getByRole("button", { name: "重命名附件" })).toHaveCount(0);
    await toolbar.getByRole("button", { name: "复制附件链接" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { copiedFile: string }).copiedFile)).toBe("https://example.com/report.pdf");
    await page.context().route("https://example.com/report.pdf", (route) => route.fulfill({ contentType: "text/plain", body: "test attachment" }));
    const popupPromise = page.waitForEvent("popup"); await toolbar.getByRole("button", { name: "打开附件", exact: true }).click();
    const popup = await popupPromise; await expect(popup).toHaveURL("https://example.com/report.pdf"); await popup.close();
    await attachment.locator(".file-attachment-card").click();
    await expect(toolbar.getByRole("button", { name: "下载附件" })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
