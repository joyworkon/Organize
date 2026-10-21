import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  await expect(page.locator(".tiptap.organize-editor")).toHaveAttribute("contenteditable", "true");
});

test("title Enter split and bidirectional start navigation preserve text and IME", async ({ page }) => {
  const title = page.locator("textarea.note-title"); const editor = page.locator(".tiptap.organize-editor");
  await title.fill("标题正文"); await title.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 2)); await title.press("Enter");
  await expect(title).toHaveValue("标题"); await expect(editor.locator("p").first()).toHaveText("正文"); await expect(editor).toBeFocused();
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowUp"); await expect(title).toBeFocused();
  await title.press("ArrowDown"); await expect(editor).toBeFocused(); await page.keyboard.press("Backspace"); await expect(title).toBeFocused();
  await title.dispatchEvent("keydown", { key: "Enter", isComposing: true }); await expect(title).toHaveValue("标题"); await expect(title).toBeFocused();
  await title.fill("很长的标题自动换行以验证最后一行方向键行为".repeat(12));
  await title.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 0)); await title.press("ArrowDown"); await expect(title).toBeFocused();
  // A caret inside the last visual line also enters the first body block.
  await title.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(node.value.length - 1, node.value.length - 1)); await title.press("ArrowDown"); await expect(editor).toBeFocused();
});

test("icon picker search, arrow keys, Enter, Escape and recent icons", async ({ page }) => {
  const trigger = page.getByRole("button", { name: /更改页面图标|添加图标/ });
  await page.locator("textarea.note-title").focus(); await trigger.click();
  await page.getByRole("textbox", { name: "搜索图标" }).fill("幼苗");
  await page.getByRole("button", { name: /🌱 幼苗/ }).focus(); await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused(); await expect(trigger).toHaveText("🌱");
  await trigger.click(); await page.getByRole("button", { name: "最近使用", exact: true }).click(); await expect(page.getByRole("button", { name: /🌱 幼苗/ })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await trigger.click(); await page.getByRole("button", { name: "常用", exact: true }).click();
  const icons = page.getByRole("group", { name: "图标列表" }).getByRole("button"); await icons.first().focus(); await page.keyboard.press("ArrowRight"); await expect(icons.nth(1)).toBeFocused();
});

test("cover upload and pointer/keyboard reposition can cancel and confirm", async ({ page }) => {
  await page.getByRole("button", { name: "更换", exact: true }).click();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="400" fill="#777"/><rect y="400" width="1200" height="400" fill="#bbb"/></svg>';
  await page.getByLabel("上传封面图片").setInputFiles({ name: "cover.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  const cover = page.getByRole("group", { name: "笔记封面", exact: true }); await expect(cover).toBeVisible(); await expect(cover).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "调整封面位置" }).click(); const region = page.getByRole("group", { name: "调整封面位置", exact: true });
  await expect(region).toBeFocused(); await region.press("ArrowDown"); await region.press("Escape"); await expect(region).toHaveCount(0);
  await expect(cover).toHaveCSS("background-position", "50% 50%");
  await page.getByRole("button", { name: "调整封面位置" }).click(); const box = await region.boundingBox(); if (!box) throw new Error("missing cover region");
  await page.mouse.move(box.x + box.width / 2, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + 10); await page.mouse.up();
  await expect(region).not.toHaveCSS("background-position", "50% 50%"); await page.getByRole("button", { name: "保存位置" }).click(); await expect(region).toHaveCount(0);
  await expect(cover).not.toHaveCSS("background-position", "50% 50%");
});
