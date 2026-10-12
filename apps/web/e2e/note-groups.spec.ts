import { expect, test, type Page } from "@playwright/test";

async function openNotes(page: Page) {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes");
  await expect(page.getByRole("button", { name: "自动分组" })).toBeVisible();
}

test("note groups: create, move via menu, filter, rename, delete", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "新建分组" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("工作");
  await page.getByRole("dialog").getByRole("button", { name: "创建" }).click();
  const chip = page.locator('[data-group-chip]').filter({ hasText: "工作" });
  await expect(chip).toBeVisible();

  await page.locator('[data-group-chip="all"]').getByRole("button").click();
  const firstCard = page.locator("main").getByRole("button", { name: "更多操作", exact: true }).first();
  await firstCard.click();
  await page.getByRole("menuitem", { name: "移到分组…" }).click();
  await page.getByRole("dialog").getByRole("option", { name: /工作/ }).click();
  await expect(chip).toContainText("1");

  await chip.getByRole("button", { name: /操作/ }).click();
  await page.getByRole("menuitem", { name: "重命名" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("项目");
  await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  const renamed = page.locator('[data-group-chip]').filter({ hasText: "项目" });
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: /操作/ }).click();
  await page.getByRole("menuitem", { name: "删除分组" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除分组" }).click();
  await expect(renamed).toHaveCount(0);
});

test("note groups: auto-group shows an editable preview and applies only on confirm", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "自动分组" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("确认前不会改动任何笔记", { exact: false })).toBeVisible();
  const preview = page.getByTestId("auto-group-preview");
  await expect(preview.getByText("正在分析笔记内容…")).toHaveCount(0, { timeout: 15_000 });
  const sections = preview.locator("section");
  if ((await sections.count()) === 0) {
    await expect(preview).toContainText("没有找到足够明显的共同主题");
    return;
  }
  await sections.first().getByLabel("分组名称").fill("自动分组测试");
  await dialog.getByRole("button", { name: /应用 \d+ 个分组/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-group-chip]').filter({ hasText: "自动分组测试" })).toBeVisible();
});
