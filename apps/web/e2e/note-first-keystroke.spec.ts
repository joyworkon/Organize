import { expect, test } from "@playwright/test";

/**
 * 回归：新建笔记后标题自动聚焦，用户立刻点正文空白处（编辑器 padding）再打字，
 * 首字曾会落进标题——编辑器在 mousedown 上 preventDefault（用于框选）连带取消了
 * 浏览器「按下即聚焦」，直到松开鼠标才聚焦正文。修复后按下即把焦点交给编辑器。
 */
test("new note: first keystroke after clicking the body never lands in the title", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toBeVisible();

  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
    await expect(page).not.toHaveURL(/note-1$/);
    const title = page.locator("textarea.note-title");
    await expect(title).toBeFocused();
    await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 15_000 });

    // 点编辑器自身（而非段落文字）：命中框选分支，复现 mousedown 被 preventDefault 的路径
    const box = await editor.boundingBox();
    if (!box) throw new Error("editor has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
    await page.mouse.down();
    await page.keyboard.insertText("正");
    await page.mouse.up();
    await page.keyboard.insertText("文");

    await expect(title).toHaveValue("");
    await expect(editor).toContainText("正文");
  }
});
