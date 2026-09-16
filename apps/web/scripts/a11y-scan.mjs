// C02 键盘与可访问性：axe-core 自动扫描脚本（非 CI 门禁，人工审计工具）
//
// 用法（mock 栈运行中）：
//   NEXT_PUBLIC_MOCK_BACKEND=true ... npx next start -p 3100   # mock web
//   node scripts/a11y-scan.mjs
//
// 品牌色已于 2026-09-16 收敛为单色（原 A11Y_SCAN_BRANDS 多品牌复扫已移除）。
// 覆盖 C02 卡面范围：主导航（每页侧栏）、笔记编辑页（含选中文字弹 BubbleMenu）、
// 任务工作台（含任务详情对话框）、速记、共享对话框；外加 200% 缩放口径
// （640px 视口 = 1280 布局在浏览器 200% 下的 CSS 视口等价）复扫布局类规则。
// 输出：按规则聚合的违规清单（rule → 页面 → 节点选择器样本），供分类定修复面。
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const BASE = process.env.A11Y_BASE_URL ?? "http://127.0.0.1:3100";
const results = [];

async function newPage(browser, { width = 1280, height = 720 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("邮箱地址").fill("smoke@example.com");
  await page.getByPlaceholder("密码").fill("smoke-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/library/);
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  }).catch(() => {});
  return { context, page };
}

async function scan(page, label) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
  const axeResult = await page.evaluate(axeSource => {
    // @ts-expect-error 注入的全局
    window.axe = undefined;
    const script = document.createElement("script");
    script.textContent = axeSource;
    document.head.appendChild(script);
    // @ts-expect-error axe 全局
    return window.axe.run(document, {
      resultTypes: ["violations"],
      rules: { "region": { enabled: false }, "landmark-one-main": { enabled: false } },
    }).then(r => r.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 6).map(n => n.target.join(" ")),
      count: v.nodes.length,
    })));
  }, axeSource);
  for (const v of axeResult) {
    results.push({ page: label, ...v });
  }
  console.log(`[${label}] ${axeResult.length} 类违规`);
}

const browser = await chromium.launch();
{
  const { context, page } = await newPage(browser);
  for (const route of ["/library", "/inbox", "/notes", "/tasks", "/tasks/lessons", "/memos", "/favorites", "/trash", "/settings"]) {
    await page.goto(`${BASE}${route}`);
    await scan(page, route);
  }

  // 笔记编辑页：先扫默认态（新建后标题持有焦点，标题区「添加图标/封面/评论」
  // 经 :focus-within 可见——这是键盘用户真实可见态，2026-09 第四轮曾在此扫出
  // hover-only 态扫不到的 color-contrast），再扫选中文字弹 BubbleMenu 态
  await page.goto(`${BASE}/notes`);
  await page.getByRole("button", { name: /新建笔记/ }).first().click();
  await page.waitForURL(/\/notes\//);
  await page.waitForTimeout(1500);
  await scan(page, "/notes/[id] (默认态)");
  const editor = page.locator(".tiptap, .ProseMirror").first();
  await editor.click();
  await page.waitForTimeout(800);
  await page.keyboard.type("可访问性扫描样例正文内容");
  await page.waitForTimeout(1500);
  await editor.getByText("可访问性扫描样例正文内容").first().selectText().catch(() => {});
  await page.waitForTimeout(600);
  await scan(page, "/notes/[id] (BubbleMenu 开)");

  // 任务详情对话框（点开第一个任务行）
  await page.goto(`${BASE}/tasks`);
  await page.waitForTimeout(1000);
  const taskRow = page.locator("table tbody tr, [data-task-row], [role=row]").first();
  if (await taskRow.count()) {
    await taskRow.click();
    await page.waitForTimeout(800);
    await scan(page, "/tasks (详情开)");
  } else {
    console.log("[/tasks (详情开)] 无任务行可点，跳过");
  }

  // 共享对话框：从笔记页打开
  const shareBtn = page.getByRole("button", { name: /分享|共享/ }).first();
  await page.goto(`${BASE}/notes`);
  await page.getByRole("button", { name: /新建笔记/ }).first().click();
  await page.waitForURL(/\/notes\//);
  await page.waitForTimeout(1000);
  const shareOnNote = page.getByRole("button", { name: /分享|共享/ }).first();
  if (await shareOnNote.count()) {
    await shareOnNote.click();
    await page.waitForTimeout(800);
    await scan(page, "/notes/[id] (共享对话框开)");
  }

  await context.close();
}

// 200% 缩放口径（640×720）复扫核心三页
{
  const { context, page } = await newPage(browser, { width: 640, height: 720 });
  for (const route of ["/library", "/tasks", "/memos"]) {
    await page.goto(`${BASE}${route}`);
    await scan(page, `${route} @200%`);
  }
  await context.close();
}

await browser.close();

// 按规则聚合输出
const byRule = new Map();
for (const r of results) {
  if (!byRule.has(r.id)) byRule.set(r.id, { impact: r.impact, help: r.help, pages: [], total: 0 });
  const entry = byRule.get(r.id);
  entry.pages.push(`${r.page}(${r.count})`);
  entry.total += r.count;
}
console.log("\n=== 按规则聚合（impact | rule | 总节点 | 页面分布 | 样本选择器）===");
const rows = [...byRule.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [id, e] of rows) {
  console.log(`${e.impact ?? "?"} | ${id} | ${e.total} | ${e.pages.join(", ")}`);
}
console.log("\n=== 节点选择器样本（每规则前 3 页各 2 条）===");
for (const [id] of rows) {
  const samples = results.filter(r => r.id === id).flatMap(r => r.nodes.slice(0, 2).map(n => `[${r.page}] ${n}`)).slice(0, 6);
  console.log(`${id}:\n${samples.map(s => "  " + s).join("\n")}`);
}
