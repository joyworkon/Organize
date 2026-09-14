import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * C02 第一轮回归门（读屏名称类）：核心页面上不得存在无可访问名称的按钮
 * （axe button-name 规则，含 role=combobox 的 Select 触发器与图标按钮）。
 * 本 spec 在 CI e2e-test job（mock 构建）常跑；新增图标按钮/下拉若不带
 * aria-label 会被此处拦下。其余违规类（对比度/标题层级/嵌套交互等）是
 * C02 后续轮次，不在此断言。
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

/** 注入 axe 并断言 button-name 违规为零（失败时列出节点选择器） */
async function expectAllButtonsNamed(page: Page, label: string) {
  const targets = await page.evaluate((src) => {
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
          .filter((v) => v.id === "button-name")
          .flatMap((v) => v.nodes.map((n) => n.target.join(" ")))
      );
  }, axeSource);
  expect(targets, `${label} 存在无可访问名称的按钮`).toEqual([]);
}

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
