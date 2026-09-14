import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * C02 回归门：核心页面可访问性回归（axe 注入式断言）。
 * 用例 1（第一轮）：读屏名称——全部按钮有可访问名称（button-name）。
 * 用例 2（第二/三轮）：标题层级——页面有 h1 且不跳级（heading-order /
 * page-has-heading-one），编辑器壳 tippy aria-allowed-attr 与表单 label。
 * 用例 3（第四/五轮）：对比度与嵌套交互——color-contrast（侧栏选中态中性化、
 * 弱化文本去透明度后归零）与 nested-interactive（任务行去交互嵌套后归零）。
 * 本 spec 在 CI e2e-test job（mock 构建）常跑；同类新违规会被此处拦下。
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires -- Playwright TS 转译为 CJS，import.meta 不可用
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** 每个用例前置：预置「已完成引导」+ goto + 等待 React 水合完成（与 smoke 同款） */
async function openPage(page: Page, path: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

/** 注入 axe 并断言指定规则违规为零（失败时列出节点选择器） */
async function expectRulesClean(page: Page, label: string, ruleIds: string[]) {
  const targets = await page.evaluate(({ src, rules }) => {
    const script = document.createElement("script");
    script.textContent = src;
    document.head.appendChild(script);
    const axe = (window as unknown as {
      axe: { run: (ctx: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> };
    }).axe;
    return axe
      .run(document, { resultTypes: ["violations"] })
      .then((r) =>
        r.violations
          .filter((v) => rules.includes(v.id))
          .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`))
      );
  }, { src: axeSource, rules: ruleIds });
  expect(targets, `${label} 存在可访问性违规（${ruleIds.join("/")}）`).toEqual([]);
}

function expectAllButtonsNamed(page: Page, label: string) {
  return expectRulesClean(page, label, ["button-name"]);
}

/** C02 第一轮：读屏名称 */
test("C02 读屏名称回归：核心页面全部按钮有可访问名称", async ({ page }) => {
  // 登录（mock）：登录表单按钮本身也在被测范围内
  await openPage(page, "/login");
  await page.getByPlaceholder("邮箱地址").fill("smoke@example.com");
  await page.getByPlaceholder("密码").fill("smoke-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/library/);

  for (const route of ["/library", "/notes", "/tasks", "/tasks/lessons", "/memos", "/favorites", "/settings"]) {
    await openPage(page, route);
    await expectAllButtonsNamed(page, route);
  }

  // 笔记编辑页 + 共享对话框打开态（C02 卡面范围：笔记编辑菜单、共享对话框）
  await openPage(page, "/notes");
  await page.getByRole("button", { name: /新建笔记/ }).first().click();
  await page.waitForURL(/\/notes\//);
  await page.waitForTimeout(1200);
  await expectAllButtonsNamed(page, "/notes/[id]");

  const shareButton = page.getByRole("button", { name: /分享|共享/ }).first();
  await shareButton.click();
  await page.waitForTimeout(1000);
  await expectAllButtonsNamed(page, "/notes/[id] 共享对话框");
});

/** C02 第二轮：标题层级（heading-order 跳级 + page-has-heading-one 缺一级标题） */
test("C02 标题层级回归：页面有 h1 且标题不跳级", async ({ page }) => {
  await openPage(page, "/login");
  await page.getByPlaceholder("邮箱地址").fill("smoke@example.com");
  await page.getByPlaceholder("密码").fill("smoke-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/library/);

  for (const route of ["/library", "/notes", "/tasks", "/tasks/lessons", "/memos", "/favorites", "/trash"]) {
    await openPage(page, route);
    await expectRulesClean(page, route, ["heading-order", "page-has-heading-one"]);
  }

  // 笔记编辑页（此前无任何 h1）；选中文字弹 BubbleMenu 后，编辑器壳的
  // tippy aria-expanded 产物与封面上传 file input 也一并断言（C02 第三轮）
  await openPage(page, "/notes");
  await page.getByRole("button", { name: /新建笔记/ }).first().click();
  await page.waitForURL(/\/notes\//);
  await page.waitForTimeout(1200);
  await expectRulesClean(page, "/notes/[id]", ["page-has-heading-one"]);

  const editor = page.locator(".tiptap, .ProseMirror").first();
  await editor.click();
  await page.waitForTimeout(800);
  await page.keyboard.type("标题层级与编辑器壳回归样例");
  await page.waitForTimeout(1500);
  await editor.getByText("标题层级与编辑器壳回归样例").first().selectText().catch(() => {});
  await page.waitForTimeout(800);
  await expectRulesClean(page, "/notes/[id] BubbleMenu 开", [
    "page-has-heading-one",
    "aria-allowed-attr",
    "label",
    "color-contrast",
  ]);
});

/** C02 第四/五轮：对比度 + 嵌套交互——选中态中性化、弱化文本去透明度、任务行去交互嵌套 */
test("C02 对比度与嵌套交互回归：核心页面与笔记编辑页无违规", async ({ page }) => {
  await openPage(page, "/login");
  await page.getByPlaceholder("邮箱地址").fill("smoke@example.com");
  await page.getByPlaceholder("密码").fill("smoke-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/library/);

  for (const route of ["/library", "/notes", "/tasks", "/tasks/lessons", "/memos", "/favorites", "/settings"]) {
    await openPage(page, route);
    await expectRulesClean(page, route, ["color-contrast", "nested-interactive"]);
  }

  // 笔记编辑页默认态：新建后标题持有焦点，标题区「添加图标/封面/评论」按钮
  // 经 :focus-within 可见（键盘用户真实可见态），其颜色不达标会在此拦下
  await openPage(page, "/notes");
  await page.getByRole("button", { name: /新建笔记/ }).first().click();
  await page.waitForURL(/\/notes\//);
  await page.waitForTimeout(1200);
  await expectRulesClean(page, "/notes/[id]", ["color-contrast", "nested-interactive"]);
});
