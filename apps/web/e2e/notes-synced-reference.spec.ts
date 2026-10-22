import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";

test.skip(process.env.REAL_DB_E2E === "1", "mock UX coverage; real reliability covered by synced-block.spec.ts");

// Empty block whitespace also starts block-drag selection. Place the caret through
// Tiptap's public API, then exercise typing, toolbar, native clipboard and undo normally.
async function caret(target: Locator) {
  await target.evaluate((element) => {
    const editor = (element.closest(".tiptap") as HTMLElement & { editor: Editor }).editor;
    editor.commands.setTextSelection(editor.view.posAtDOM(element, 0));
    editor.view.focus();
  });
}
async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const notes = ["source", "destination"].map((key) => ({
      op_id: `synced-reference-${key}`, created_at: Date.now(), note: {
        id: `e2e-synced-reference-${key}`, user_id: "mock-user-0001", title: `同步引用 ${key}`,
        content: { type: "doc", content: [{ type: "paragraph", attrs: { id: `blank-${key}` } }, { type: "paragraph", attrs: { id: "paste-destination" } }] },
      },
    }));
    localStorage.setItem("organize:offline:note-creates:v1", JSON.stringify(notes));
  });
  await page.goto("/notes/e2e-synced-reference-source");
  await expect(page.locator('.tiptap.organize-editor')).toBeEditable();
}

for (const width of [390, 1440]) {
  test(`copy reference, paste same source, unlink rich content and undo at ${width}px`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 1000 }); await seed(page);
    // Count the actual fetch path too: mock API is an in-page fetch shim, not network routing.
    await page.evaluate(() => {
      const original = window.fetch;
      (window as unknown as { syncedMethods: string[] }).syncedMethods = [];
      window.fetch = (input, init) => {
        if (String(input).startsWith("/api/synced-blocks")) (window as unknown as { syncedMethods: string[] }).syncedMethods.push(init?.method || "GET");
        return original(input, init);
      };
    });
    const editor = page.locator('.tiptap.organize-editor');
    await caret(editor.locator('[data-id="blank-source"]'));
    await page.keyboard.type("/同步");
    await page.locator('.block-command-popover').getByRole("option", { name: /^同步区块/ }).click();
    const source = page.locator('[data-synced-block]'); await expect(source).toHaveCount(1);
    const id = await source.getAttribute("data-synced-id"); expect(id).toBeTruthy();
    await expect(source.locator('.organize-synced-toolbar')).toContainText("已同步");
    const sourceText = source.locator('.organize-synced-content p'); await caret(sourceText);
    await page.keyboard.press("ControlOrMeta+b"); await page.keyboard.type("保留格式的同步内容"); await page.keyboard.press("ControlOrMeta+b");
    await expect(source.locator('.organize-synced-content strong')).toHaveText("保留格式的同步内容");
    await expect(source.locator('.organize-synced-toolbar')).toContainText("已同步");
    await source.getByRole("button", { name: "复制引用", exact: true }).click();
    await expect(page.getByText("已复制同步引用，粘贴到笔记可插入同一同步区块", { exact: true })).toBeVisible();
    const token = await page.evaluate(() => navigator.clipboard.readText()); expect(token).toContain(id!);
    const posts = await page.evaluate(() => (window as unknown as { syncedMethods: string[] }).syncedMethods.filter((m) => m === "POST").length);
    expect(posts).toBe(1);
    const empty = editor.locator('[data-id="paste-destination"]'); await caret(empty);
    await page.keyboard.press("ControlOrMeta+v");
    const blocks = page.locator('[data-synced-block]'); await expect(blocks).toHaveCount(2);
    const reference = blocks.nth(1);
    await expect(reference).toHaveAttribute("data-synced-id", id!);
    await expect(reference.locator('.organize-synced-content strong')).toHaveText("保留格式的同步内容");
    const childId = await reference.locator('.organize-synced-content p').getAttribute("data-id");
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`synced-reference-${width}.png`) });
    await reference.getByRole("button", { name: "解除同步", exact: true }).click();
    await expect(blocks).toHaveCount(1);
    await expect(editor.locator(`:scope > p[data-id="${childId}"] strong`)).toHaveText("保留格式的同步内容");
    await page.keyboard.press("ControlOrMeta+z"); await expect(blocks).toHaveCount(2);
    await expect(reference).toHaveAttribute("data-synced-id", id!);
    const methods = await page.evaluate(() => (window as unknown as { syncedMethods: string[] }).syncedMethods);
    expect(methods.filter((m) => m === "POST")).toHaveLength(1); expect(methods).not.toContain("DELETE");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`synced-reference-${width}-dark.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
