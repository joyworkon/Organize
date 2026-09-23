import { expect, test, type Page } from "@playwright/test";

/**
 * 文件导入（阶段 D）e2e：mock 后端模式下验证
 * 文本文件真解析入稍后读（toast / 文件行 / 统一视图可见），
 * PDF/DOCX/XLSX 诚实失败（mock 不伪造解析），失败原因可见。
 * setInputFiles 用内存 buffer，无需落盘真实文件。
 */

async function openPage(page: Page, path: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

test("导入 Markdown：真解析建条目，文件行与统一视图可见", async ({ page }) => {
  await openPage(page, "/library?view=files");
  await page.getByLabel("选择要导入的文件").setInputFiles({
    name: "e2e-import.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# E2E 导入标题\n\n- 甲\n- 乙\n"),
  });
  await expect(page.getByText("已导入 1 个文件").first()).toBeVisible();

  // 文件视图：行出现且状态已保存，可打开条目
  const row = page.locator("section[aria-label='文件导入'] li", { hasText: "e2e-import.md" });
  await expect(row.getByText("已保存")).toBeVisible();
  await expect(row.getByRole("link", { name: "打开条目" })).toBeVisible();

  // 统一（全部）视图出现导入的条目标题
  await page.getByRole("tab", { name: "全部" }).click();
  await expect(page.getByText("E2E 导入标题").first()).toBeVisible();
});

test("导入 PDF：mock 诚实失败，原因可见，可重试", async ({ page }) => {
  await openPage(page, "/library?view=files");
  await page.getByLabel("选择要导入的文件").setInputFiles({
    name: "e2e-doc.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-fake"),
  });
  await expect(page.getByText("1 个文件导入失败").first()).toBeVisible();

  const row = page.locator("section[aria-label='文件导入'] li", { hasText: "e2e-doc.pdf" });
  await expect(row.getByText("失败")).toBeVisible();
  await expect(row.getByText(/mock 后端不支持解析/)).toBeVisible();
  await expect(row.getByRole("button", { name: "重试" })).toBeVisible();

  // 注：刷新恢复依赖 import_files 表落库；mock 数据在浏览器内存中，
  // 刷新即清空，恢复语义由 lib/mock/api-shim-imports.test.ts 的 GET 形状用例覆盖，
  // 真实后端的落库恢复待 Docker 环境验证（进度文档遗留项）。
});

test("一批两个同名文件（内容不同）：两行独立、各回各的 retryKey、不错配", async ({ page }) => {
  await openPage(page, "/library?view=files");
  await page.getByLabel("选择要导入的文件").setInputFiles([
    {
      name: "e2e-same.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 内容甲"),
    },
    {
      name: "e2e-same.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 内容乙完全不同"),
    },
  ]);
  await expect(page.getByText("已导入 2 个文件").first()).toBeVisible();

  // 两行同名记录都出现（按 retryKey 配对，不按文件名 → 不会挤掉另一行）
  const rows = page.locator("section[aria-label='文件导入'] li", { hasText: "e2e-same.md" });
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByText("已保存")).toBeVisible();
  await expect(rows.nth(1).getByText("已保存")).toBeVisible();

  // 两个条目链接指向不同的阅读条目（同名不同内容 = 两份资料）
  const hrefA = await rows.first().getByRole("link", { name: "打开条目" }).getAttribute("href");
  const hrefB = await rows.nth(1).getByRole("link", { name: "打开条目" }).getAttribute("href");
  expect(hrefA).toBeTruthy();
  expect(hrefB).toBeTruthy();
  expect(hrefA).not.toBe(hrefB);
});
