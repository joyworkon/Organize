import { expect, test, type Page } from "@playwright/test";

async function chooseTemplate(page: Page, label: string) {
  await page.locator('.note-topbar button[title="更多"]').click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.keyboard.press("Escape");
}

test("note templates: editable headings, separate cards, bold and persisted appearance", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toBeVisible();
  await expect(page.locator(".note-template-red-blue")).toHaveCount(0);
  await expect(editor.locator(".organize-section-card")).toHaveCount(0);
  await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
  await expect(page).not.toHaveURL(/note-1$/);
  await expect(editor).toBeVisible();
  await page.locator("textarea.note-title").fill("模板验收");
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 15_000 });
  await editor.locator("p").first().click();
  await page.keyboard.press("ControlOrMeta+/");
  await page.getByLabel("筛选区块").fill("标题 1");
  await page.getByRole("option", { name: /^标题 1 / }).click();
  await editor.locator("h1").click();
  await page.keyboard.insertText("可编辑章节标题");
  await expect(editor.locator("h1")).toHaveText("可编辑章节标题");
  await chooseTemplate(page, "红蓝 · 圆角卡片");
  await expect(page.locator(".note-template-red-blue")).toBeVisible();
  await expect(page.getByLabel("章节英文标题")).toHaveValue("Title");
  await page.getByLabel("章节英文标题").fill("Overview");
  await page.getByLabel("章节英文标题").press("Tab");
  await page.getByRole("button", { name: "＋ 新背景块", exact: true }).click();
  await page.keyboard.insertText("新卡片正文");
  await expect(editor.locator(".organize-section-card-first")).toHaveCount(2);
  await expect(editor.locator("p[data-section-start]")).toHaveText("新卡片正文");
  // Select actual visible text, then use the formatting shortcut.
  await editor.locator("p[data-section-start]").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press("ControlOrMeta+b");
  await expect(editor.locator("p strong")).toHaveText("新卡片正文");
  expect(await editor.locator("p strong").evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  expect(await editor.locator("p strong").evaluate((el) => getComputedStyle(el).fontVariationSettings)).toBe("normal");
  await expect(editor.locator(".organize-section-card-first")).toHaveCount(2);
  for (const width of [1440, 768, 430, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const geometry = await editor.evaluate((element) => {
      const card = element.querySelector(".organize-section-card")!.getBoundingClientRect();
      const canvas = element.closest(".note-page")!.getBoundingClientRect();
      const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((candidate) => ({
          tag: candidate.tagName,
          text: candidate.textContent?.trim().slice(0, 60),
          className: candidate.className?.toString().slice(0, 100),
          left: candidate.getBoundingClientRect().left,
          right: candidate.getBoundingClientRect().right,
        }))
        .filter((candidate) => candidate.left < -0.5 || candidate.right > innerWidth + 0.5)
        .slice(0, 12);
      return { canvasLeft: canvas.left, canvasRight: innerWidth - canvas.right, left: card.left - canvas.left, right: canvas.right - card.right, scroll: document.documentElement.scrollWidth, width: innerWidth, offenders };
    });
    expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(2);
    expect(geometry.scroll, JSON.stringify(geometry.offenders)).toBeLessThanOrEqual(geometry.width);
    if (width < 768) {
      expect(Math.abs(geometry.canvasLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.canvasRight)).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: `../../.tmp-e2e/note-template-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Mock DB is in-memory: use SPA tabs to verify the saved snapshot is read back.
  await page.waitForTimeout(2000);
  await page.locator('.note-tabs-bar a[href="/notes/note-1"]').click();
  await expect(page.locator(".note-template-red-blue")).toHaveCount(0);
  await page.locator(".note-tabs-bar a", { hasText: "模板验收" }).click();
  await expect(page.locator(".note-template-red-blue")).toBeVisible();
  await expect(page.getByLabel("章节英文标题")).toHaveValue("Overview");
  await expect(editor.locator("p strong")).toHaveText("新卡片正文");
  await chooseTemplate(page, "默认 · 简洁笔记");
  await expect(editor.locator(".organize-section-card")).toHaveCount(0);
  await expect(editor).toContainText("可编辑章节标题");
  await expect(editor).toContainText("新卡片正文");
  await page.screenshot({ path: "../../.tmp-e2e/note-default-1440.png", fullPage: true });
});
