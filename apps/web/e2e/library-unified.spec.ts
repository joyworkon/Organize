import { expect, test, type Page } from "@playwright/test";

/**
 * 资料库统一入口（阶段 C）e2e：mock 后端模式下验证
 * 统一输入框四种分流、/memos 重定向兼容（compose/memo 深链）、
 * 侧栏资料库入口与行内「+」、全部视图游标翻页不重不漏、旧文章详情可达。
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

test("统一输入框：单链接 → 稍后读条目，全部视图可见", async ({ page }) => {
  await openPage(page, "/library");
  await page.getByLabel("资料库统一输入").fill("https://example.com/unified-single");
  await page.keyboard.press("Enter");
  await expect(page.getByText("已保存到稍后读").first()).toBeVisible();
  await expect(page.getByText("Unified single").first()).toBeVisible();
});

test("统一输入框：多链接逐条保存，逐项可见", async ({ page }) => {
  await openPage(page, "/library");
  await page.getByLabel("资料库统一输入").fill(
    "https://example.com/batch-one https://example.com/batch-two"
  );
  await page.keyboard.press("Enter");
  await expect(page.getByText("Batch one").first()).toBeVisible();
  await expect(page.getByText("Batch two").first()).toBeVisible();
});

test("统一输入框：文字夹带链接 → 完整文字存速记，toast 可另存其中链接", async ({ page }) => {
  await openPage(page, "/library");
  await page.getByLabel("资料库统一输入").fill("这篇 https://example.com/ref-article 值得读");
  await page.keyboard.press("Enter");
  await expect(page.getByText("已保存为速记").first()).toBeVisible();
  // 完整文字保留（速记卡片 = 正文首行）
  await expect(page.getByText(/这篇 https:\/\/example\.com\/ref-article 值得读/).first()).toBeVisible();

  await page.getByRole("button", { name: "另存其中链接" }).click();
  await expect(page.getByText("已保存到稍后读").first()).toBeVisible();
  await expect(page.getByText("Ref article").first()).toBeVisible();
});

test("统一输入框：>5000 字长文 → 物料条目（不截断）", async ({ page }) => {
  await openPage(page, "/library");
  const body = "长".repeat(6000);
  await page.getByLabel("资料库统一输入").fill(`统一物料长文标题\n\n${body}`);
  await page.keyboard.press("Enter");
  await expect(page.getByText("已保存到稍后读").first()).toBeVisible();
  await expect(page.getByText("统一物料长文标题").first()).toBeVisible();
});

test("/memos?compose=1 重定向保留 view=memos 并聚焦统一输入框", async ({ page }) => {
  await openPage(page, "/memos?compose=1");
  await expect(page).toHaveURL(/\/library\?view=memos$/);
  await expect(page.getByLabel("资料库统一输入")).toBeFocused();
});

test("/memos?memo=<id> 深链到速记视图并高亮目标速记", async ({ page }) => {
  await openPage(page, "/memos?memo=mock-memo-2");
  // 重定向保留 memo 深链参数并附加 view=memos（参数顺序是实现细节，不断言顺序）
  await expect(page).toHaveURL(/\/library\?/);
  await expect(page).toHaveURL(/memo=mock-memo-2/);
  await expect(page).toHaveURL(/view=memos/);
  const target = page.locator("#memo-mock-memo-2");
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/ring-2/);
  await expect(page.getByText("速记的入口要离手最近").first()).toBeVisible();
});

test("侧栏：资料库入口保留标签分组，行内「+」聚焦统一输入框，速记一级项移除", async ({ page }) => {
  await openPage(page, "/library");
  const nav = page.locator("nav").first();
  await expect(nav.getByRole("link", { name: "资料库" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "速记" })).toHaveCount(0);

  await nav.getByRole("button", { name: "快速记录" }).click();
  await expect(page.getByLabel("资料库统一输入")).toBeFocused();
});

test("全部视图：两页游标翻页无重复无遗漏", async ({ page }) => {
  await openPage(page, "/library");
  // mock 种子 11 条（7 读 + 4 记）；再补 22 条链接 → 33 条 > PAGE_SIZE(30)
  const urls = Array.from(
    { length: 22 },
    (_, i) => `https://example.com/paged-item-${String(i).padStart(2, "0")}`
  );
  await page.getByLabel("资料库统一输入").fill(urls.join(" "));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Paged item 21").first()).toBeVisible();

  const firstPageTitles = await page.locator("h2").allTextContents();
  expect(firstPageTitles).toHaveLength(30);

  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.getByText("Paged item 00").first()).toBeVisible();
  const allTitles = await page.locator("h2").allTextContents();
  expect(allTitles).toHaveLength(33);
  expect(new Set(allTitles).size).toBe(33);
});

test("旧文章详情链接可达：稍后读视图卡片进入 /library/[id]", async ({ page }) => {
  await openPage(page, "/library?view=reading");
  await page.locator("h2").first().click();
  await expect(page).toHaveURL(/\/library\/item-/);
  // 文章详情页正文大标题（mock 种子第一篇；顶栏同名 span 为 md:hidden，须用 heading 角色锁定可见标题）
  await expect(page.getByRole("heading", { name: "useEffect 完全指南" })).toBeVisible();
});
