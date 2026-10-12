import { expect, test } from "@playwright/test";

// 目录刻度（TocMinimap）：每个标题一条短横线；悬停伸长并浮出摘要卡片；点击跳转并高亮当前章节；键盘可达
test("note editor: toc minimap hover card, click jump and scroll-spy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
  await expect(page).not.toHaveURL(/note-1$/);
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 15_000 });
  await editor.click();
  for (const heading of ["背景", "目标", "方案", "风险"]) {
    await page.keyboard.type("## ");
    await page.keyboard.insertText(heading);
    await page.keyboard.press("Enter");
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.insertText(`${heading}的第 ${i + 1} 段说明`);
      await page.keyboard.press("Enter");
    }
  }

  const minimap = page.getByTestId("toc-minimap");
  const dashes = minimap.getByRole("button");
  await expect(dashes).toHaveCount(4);
  await expect(dashes.nth(2)).toHaveAccessibleName("跳转到：方案");

  await dashes.nth(2).hover();
  const card = page.getByTestId("toc-minimap-card");
  await expect(card).toContainText("方案");
  await expect(card).toContainText("方案的第 1 段说明");

  await dashes.first().click();
  await expect(dashes.first()).toHaveAttribute("aria-current", "location");
  await page.mouse.move(900, 450);
  await expect(card).toHaveCount(0);

  await dashes.nth(3).focus();
  await expect(page.getByTestId("toc-minimap-card")).toContainText("风险");
  await page.keyboard.press("Enter");
  await expect(dashes.nth(3)).toHaveAttribute("aria-current", "location");
});

test("toc minimap hides on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  await expect(page.locator(".tiptap.organize-editor")).toBeVisible();
  await expect(page.getByTestId("toc-minimap")).toHaveCount(0);
});
