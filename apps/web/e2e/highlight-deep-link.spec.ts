import { expect, test, type Page } from "@playwright/test";

/**
 * E02-2 跨页高亮锚点回跳（mock 后端）：
 * 阅读页选中建高亮 → 转为任务 → 任务页「关联内容」链接携带 ?hl={highlightId} →
 * 回到阅读页（SPA 重挂载，mark 已清空）后按高亮正文定位并重建 mark、滚动进入视口。
 *
 * mock 状态是页面 JS 内存库：SPA 导航保持、整页 reload 重置，因此全程用 SPA 导航。
 */

const ONBOARDED_KEY = "organize:onboarded";

async function openPage(page: Page, path: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

test("任务关联阅读深链 ?hl= 定位到来源高亮", async ({ page }) => {
  await openPage(page, "/library");

  // 保存一篇 mock 抓取文章（标题由 slug 生成，首字母大写）
  await page.getByLabel("快速添加链接").fill("https://example.com/hl-deep-link-article");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("Hl deep link article").first()).toBeVisible();

  // 打开阅读页
  await page.getByText("Hl deep link article").first().click();
  await page.waitForURL(/\/library\/[^/?#]+$/);

  // 程序化选中文本触发高亮菜单，直接点「转为任务」（创建高亮 + 幂等转换 + 跳转任务页）
  const selectedText = await page.evaluate(() => {
    const container = document.querySelector(".reader-content");
    if (!container) return null;
    for (const p of Array.from(container.querySelectorAll("p"))) {
      const textNode = Array.from(p.childNodes).find(
        (n) => n.nodeType === 3 && (n.nodeValue?.trim().length ?? 0) >= 12
      ) as Text | undefined;
      if (!textNode) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return textNode.textContent;
    }
    return null;
  });
  expect(selectedText).not.toBeNull();

  await page.getByTitle("转为任务").click();
  await page.waitForURL(/\/tasks\/[^/?#]+$/);
  await expect(page.getByText("任务创建成功").first()).toBeVisible();

  // 任务详情「关联内容」的阅读链接应携带来源高亮 id
  const readingLink = page.getByRole("link", { name: /Hl deep link article/ }).first();
  await expect(readingLink).toBeVisible({ timeout: 10_000 });
  await expect(readingLink).toHaveAttribute("href", /\/library\/[^/?#]+\?hl=[^/?#]+$/);
  await readingLink.click();
  await page.waitForURL(/\/library\/[^/?#]+\?hl=/);

  // 阅读页重挂载后深链定位：mark 按高亮正文重建并滚动进入视口
  await page.waitForSelector("mark.hl-yellow");
  await expect(page.locator("mark.hl-yellow")).toHaveText(selectedText!);
  await page.waitForTimeout(1200);
  const inViewport = await page.evaluate(() => {
    const mark = document.querySelector("mark.hl-yellow");
    if (!mark) return false;
    const rect = mark.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  expect(inViewport).toBe(true);
});
