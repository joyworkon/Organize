import { expect, test, type Locator, type Page } from "@playwright/test";

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify([{
      op_id: "paste-embed", created_at: Date.now(), note: {
        id: "e2e-paste-embed", user_id: "mock-user-0001", title: "粘贴链接预览",
        content: { type: "doc", content: [
          { type: "paragraph", attrs: { id: "empty-card" } },
          { type: "paragraph", attrs: { id: "inline-text" }, content: [{ type: "text", text: "你好世界" }] },
          { type: "codeBlock", attrs: { id: "code-paste" } },
          { type: "paragraph", attrs: { id: "slash-url" }, content: [{ type: "text", text: "example.com/from-slash" }] },
          { type: "paragraph", attrs: { id: "video-paste" } },
          { type: "paragraph", attrs: { id: "empty-slash" } },
          { type: "embed", attrs: { url: "https://example.com/legacy" } },
        ] },
      },
    }]));
  });
  await page.goto("/notes/e2e-paste-embed");
  await expect(page.locator(".tiptap.organize-editor")).toContainText("你好世界");
}

async function caret(target: Locator, offset = 0) {
  await target.evaluate((element, at) => {
    const range = document.createRange();
    if (element.firstChild?.nodeType === Node.TEXT_NODE) range.setStart(element.firstChild, at);
    else range.setStart(element, 0);
    range.collapse(true);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    (element.closest('[contenteditable="true"]') as HTMLElement).focus();
    document.dispatchEvent(new Event("selectionchange"));
  }, offset);
}
async function paste(target: Locator, text: string) {
  await target.evaluate((element, value) => {
    const data = new DataTransfer(); data.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  }, text);
}

for (const width of [390, 1440]) {
  test(`empty URL paste, inline/code exclusions, slash and legacy previews at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 }); await seed(page);
    const editor = page.locator(".tiptap.organize-editor");
    await expect(editor.locator('.organize-link-card[href="https://example.com/legacy"]')).toContainText("Mock 链接卡片");
    const empty = editor.locator('[data-id="empty-card"]'); await caret(empty); await paste(empty, "https://example.com/a");
    const card = editor.locator('[data-embed][data-id="empty-card"]');
    await expect(card.locator('.organize-link-card')).toContainText("Mock 链接卡片");
    await expect(card).toHaveAttribute("data-embed-status", "ready");
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`paste-card-${width}-light.png`) });
    const inline = editor.locator('[data-id="inline-text"]'); await caret(inline, 2); await paste(inline, "https://example.com/inline");
    await expect(inline.locator('a')).toHaveAttribute("href", "https://example.com/inline");
    await expect(inline).toContainText("你好https://example.com/inline世界");
    const code = editor.locator('[data-id="code-paste"] code'); await caret(code); await paste(code, "https://example.com/code");
    await expect(code).toHaveText("https://example.com/code");
    const slash = editor.locator('[data-id="slash-url"]'); await caret(slash); await page.keyboard.type("/embed");
    await expect(page.locator('.block-command-popover').getByRole("option", { name: /^嵌入/ })).toBeVisible();
    await page.locator('.block-command-popover').getByRole("option", { name: /^嵌入/ }).click();
    await expect(editor.locator('[data-embed][data-id="slash-url"] .organize-link-card')).toContainText("Mock 链接卡片");
    const video = editor.locator('[data-id="video-paste"]'); await caret(video); await paste(video, "https://youtu.be/mock-video");
    const frame = editor.locator('[data-embed][data-id="video-paste"] iframe'); await expect(frame).toBeVisible();
    expect(await frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`paste-card-${width}-dark.png`) });
    const blank = editor.locator('[data-id="empty-slash"]'); await caret(blank); await page.keyboard.type("/embed"); await page.locator('.block-command-popover').getByRole("option", { name: /^嵌入/ }).click();
    const placeholder = editor.locator('[data-embed][data-id="empty-slash"]'); await expect(placeholder).toContainText("粘贴一个链接");
    await placeholder.getByRole("button", { name: "编辑链接", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑嵌入链接", exact: true }); await expect(dialog).toBeVisible();
    await dialog.getByLabel("链接 URL").press("Escape"); await expect(dialog).toHaveCount(0);
    await placeholder.getByRole("button", { name: "编辑链接", exact: true }).click();
    await expect(dialog.getByLabel("链接 URL")).toBeFocused();
    await page.locator(".organize-dialog-overlay").click({ position: { x: 10, y: 10 } }); await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("failed preview keeps its URL, shows loading, and retries in place", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 1000 }); await seed(page);
  await page.evaluate(() => {
    const original = window.fetch;
    let requests = 0;
    window.fetch = async (input, init) => {
      if (input === "/api/oembed" && String(init?.body).includes("retry.example.com")) {
        requests++;
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (requests === 1) return new Response(JSON.stringify({ error: "网络暂时不可用" }), { status: 502 });
      }
      return original(input, init);
    };
  });
  const editor = page.locator(".tiptap.organize-editor"), empty = editor.locator('[data-id="empty-card"]');
  await caret(empty); await paste(empty, "https://retry.example.com/a");
  const block = editor.locator('[data-embed][data-id="empty-card"]');
  await expect(block).toContainText("解析中…"); await expect(block).toHaveAttribute("data-embed-status", "loading");
  await expect(block.getByRole("alert")).toContainText("网络暂时不可用");
  await expect(block).toContainText("https://retry.example.com/a"); await expect(block.locator(".organize-link-card")).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("paste-url-error-mobile.png") });
  await block.getByRole("button", { name: "重试", exact: true }).click();
  await expect(block.locator(".organize-link-card")).toContainText("Mock 链接卡片");
});
