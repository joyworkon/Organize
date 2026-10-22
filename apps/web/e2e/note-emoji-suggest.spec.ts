import { expect, test } from "@playwright/test";

/**
 * 正文「:关键词」emoji 建议：打 :fire 出浮层，Enter 插入 🔥 并替换短码；
 * Esc 保留已输入文本；:fire: 收尾冒号直接替换；12:30 / http:// 不触发；窄屏不出屏。
 */
test(":fire opens emoji suggestions and Enter inserts the emoji over the shortcode", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
  await expect(page).not.toHaveURL(/note-1$/);
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 15_000 });
  await editor.locator("p").first().click();

  await page.keyboard.insertText("前文 ");
  await page.keyboard.type(":fire");
  const picker = page.locator(".emoji-suggest-popover");
  const list = picker.getByRole("listbox", { name: "插入表情" });
  await expect(list).toBeVisible();
  const first = list.getByRole("option").first();
  await expect(first).toContainText("🔥");
  await expect(first).toContainText("fire");
  await expect(first.locator("mark")).toHaveText("fire");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ animations: "disabled", path: ".tmp-e2e/emoji-suggest-desktop.png" });

  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(editor).toContainText("前文 🔥");
  await expect(editor).not.toContainText(":fire");
  // 插入后可以继续正常输入
  await page.keyboard.insertText("继续");
  await expect(editor).toContainText("前文 🔥继续");
});

test("12:30 and URLs never open, Escape keeps text, and :fire: replaces directly", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.locator("p").first().click();

  // 时间写法不触发
  await page.keyboard.type("12:30");
  await expect(page.locator(".emoji-suggest-popover")).toHaveCount(0);
  // URL 写法不触发
  await page.keyboard.press("Enter");
  await page.keyboard.type("http://example.com");
  await expect(page.locator(".emoji-suggest-popover")).toHaveCount(0);

  // Esc 关闭并保留已输入文本，继续输入不重开
  await page.keyboard.press("Enter");
  await page.keyboard.type(":fir");
  const picker = page.locator(".emoji-suggest-popover");
  await expect(picker.getByRole("listbox", { name: "插入表情" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(editor).toContainText(":fir");

  // 补齐 :fire: 后收尾冒号直接替换（逐键输入，收尾冒号单独触发）
  await page.keyboard.type("e:");
  await expect(picker).toHaveCount(0);
  await expect(editor).toContainText("🔥");
  await expect(editor).not.toContainText(":fir");
  await expect(editor).toContainText("12:30");
  await expect(editor).toContainText("http://example.com");
});

test("emoji popover stays within a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(":fire");
  const picker = page.locator(".emoji-suggest-popover");
  await expect(picker.getByRole("listbox", { name: "插入表情" })).toBeVisible();
  const box = await picker.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
});
