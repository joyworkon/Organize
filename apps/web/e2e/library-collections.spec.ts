import { expect, test, type Page } from "@playwright/test";

/**
 * 主题集合（阶段 3）e2e：mock 后端模式。
 * 覆盖：新建集合、阅读条目/速记卡片「加入集合」（对话框 + 建议芯片确认制）、
 * 集合详情（三源并列、来源状态）、移出、重命名、删除集合（来源保留）、
 * 同批导入文件「本批加入集合」、深链 /library?view=collections&collection=<id>。
 */

async function openPage(page: Page, path: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

/** 集合列表行内「名称」按钮（行内第一个 button；可访问名含计数，不用 exact 匹配） */
function collectionNameButton(page: Page, name: string) {
  return page.getByLabel("集合列表").locator("li").filter({ hasText: name }).locator("button").first();
}

async function createCollection(page: Page, name: string) {
  await page.getByLabel("新建集合名").fill(name);
  await page.getByRole("button", { name: "新建集合", exact: true }).click();
  await expect(collectionNameButton(page, name)).toBeVisible();
}

async function addCardToCollection(page: Page, cardTitle: string, collectionName: string) {
  const card = page.locator("[data-library-card]", { hasText: cardTitle }).first();
  await card.getByRole("button", { name: /^加入集合/ }).click();
  const dialog = page.getByRole("dialog", { name: "加入集合" });
  await dialog.getByRole("button", { name: new RegExp(collectionName) }).click();
  await expect(page.getByText(`已把 1 项加入「${collectionName}」`).first()).toBeVisible();
}

test("新建集合 → 网页与速记加入 → 详情三源可见 → 深链与 URL 同步", async ({ page }) => {
  await openPage(page, "/library?view=collections");
  await createCollection(page, "产品发布");

  // 造一条网页（稍后读）与一条速记，分别加入集合
  await page.getByLabel("资料库统一输入").fill("https://example.com/launch-plan");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/已保存|已存在/).first()).toBeVisible({ timeout: 10_000 });

  await page.getByLabel("资料库统一输入").fill("发布会注意事项 #产品发布");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/已保存/).first()).toBeVisible({ timeout: 10_000 });

  // 卡片列表在「全部」标签
  await page.getByRole("tab", { name: "全部" }).click();
  await addCardToCollection(page, "Launch plan", "产品发布");
  await addCardToCollection(page, "发布会注意事项", "产品发布");

  // 详情：URL 深链同步 + 两条引用可见（来源徽标）
  await page.getByRole("tab", { name: "集合" }).click();
  await collectionNameButton(page, "产品发布").click();
  await expect(page).toHaveURL(/view=collections&collection=/);
  await expect(page.getByText("Launch plan").first()).toBeVisible();
  await expect(page.getByText("发布会注意事项").first()).toBeVisible();
});

test("集合详情：移出、重命名、删除集合（来源保留）", async ({ page }) => {
  await openPage(page, "/library?view=collections");
  await createCollection(page, "待删除集");

  await page.getByLabel("资料库统一输入").fill("https://example.com/temp-item");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/已保存|已存在/).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("tab", { name: "全部" }).click();
  await addCardToCollection(page, "Temp item", "待删除集");

  await page.getByRole("tab", { name: "集合" }).click();
  await collectionNameButton(page, "待删除集").click();
  const row = page.getByLabel("集合内容").locator("li").first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "移出集合" }).click();
  await expect(page.getByText("集合里还没有内容")).toBeVisible();

  // 回列表重命名再删除
  await page.getByRole("button", { name: "← 全部集合" }).click();
  await page.getByRole("button", { name: /重命名 待删除集/ }).click();
  await page.getByLabel("集合新名称").fill("改名集");
  await page.getByLabel("集合列表").getByRole("button", { name: "保存" }).click();
  await expect(collectionNameButton(page, "改名集")).toBeVisible();

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /删除集合 改名集/ }).click();
  await expect(page.getByText("集合已删除（来源资料保留）").first()).toBeVisible();
  // 来源资料仍在（全部视图能搜到）
  await page.getByRole("tab", { name: "全部" }).click();
  await expect(page.getByText("Temp item").first()).toBeVisible();
});

test("同批导入文件「本批加入集合」→ 文件来源在集合内可下载原件", async ({ page }) => {
  await openPage(page, "/library?view=collections");
  await createCollection(page, "导入归档");

  await page.getByRole("tab", { name: "文件" }).click();
  await page.getByLabel("选择要导入的文件").setInputFiles([
    { name: "batch-a.md", mimeType: "text/markdown", buffer: Buffer.from("# 甲") },
    { name: "batch-b.md", mimeType: "text/markdown", buffer: Buffer.from("# 乙") },
  ]);
  await expect(page.getByText("已导入 2 个文件").first()).toBeVisible();

  await page.getByRole("button", { name: "本批加入集合" }).click();
  await page
    .getByRole("dialog", { name: "加入集合" })
    .getByRole("button", { name: /导入归档/ })
    .click();
  await expect(page.getByText("已把 2 项加入「导入归档」").first()).toBeVisible();

  // 集合详情：两条文件引用（同名不同内容 → 两行）
  await page.getByRole("tab", { name: "集合" }).click();
  await collectionNameButton(page, "导入归档").click();
  await expect(page.getByLabel("集合内容").locator("li")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "下载原件" }).first()).toBeVisible();
});

test("生成整理稿：勾选来源 → 预览确认；mock 下 AI 明确报错且来源不受影响", async ({ page }) => {
  await openPage(page, "/library?view=collections");
  await createCollection(page, "整理实验");

  await page.getByLabel("资料库统一输入").fill("https://example.com/digest-source");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/已保存|已存在/).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("tab", { name: "全部" }).click();
  await addCardToCollection(page, "Digest source", "整理实验");

  // 勾选 → 生成整理稿 → mock 后端 501：明确报错，不伪造成功
  await page.getByRole("tab", { name: "集合" }).click();
  await collectionNameButton(page, "整理实验").click();
  await page.getByLabel("集合内容").locator("input[type=checkbox]").first().check();
  await page.getByRole("button", { name: "生成整理稿" }).click();
  const dialog = page.getByRole("dialog", { name: "生成整理稿" });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("演示模式");
  // 取消后集合内容原样保留（来源完整可用）
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByLabel("集合内容").locator("li")).toHaveCount(1);
});
