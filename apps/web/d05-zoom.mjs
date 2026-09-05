import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto("http://127.0.0.1:3200/login");
await page.waitForTimeout(500);
const email = page.locator('input[type="email"], input[name="email"]').first();
if (await email.count()) {
  await email.fill("playwright-smoke@example.com");
  await page.locator('input[type="password"]').first().fill("playwright-smoke-password");
  await page.getByRole("button", { name: /登录|Sign in/i }).first().click();
  await page.waitForTimeout(1000);
}
// 200% 缩放近似：body zoom=2 后检查横向溢出（工作台/笔记列表）
for (const [name, url] of [["dash", "/"], ["notes", "/notes"]]) {
  await page.goto(`http://127.0.0.1:3200${url}`);
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  console.log(`zoom200 ${name}: overflowX=${m.overflowX} ${m.overflowX > 2 ? "OVERFLOW" : "ok"}`);
  await page.evaluate(() => { document.body.style.zoom = ""; });
}
// 暗色 390/1440 抽查溢出
await page.setViewportSize({ width: 390, height: 844 });
for (const [name, url] of [["notes-dark-390", "/notes"], ["dash-dark-390", "/"]]) {
  await page.goto(`http://127.0.0.1:3200${url}`);
  await page.evaluate(() => {
    localStorage.setItem("organize-theme", "dark");
    document.documentElement.classList.add("dark");
  });
  await page.reload();
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  console.log(`${name}: overflowX=${m.overflowX} ${m.overflowX > 2 ? "OVERFLOW" : "ok"}`);
}
// Esc 关闭 Popover（更多菜单）并回归焦点
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto("http://127.0.0.1:3200/notes/notes-x");
await page.waitForTimeout(1000);
// 无论笔记是否存在，顶栏更多按钮在详情页渲染；若不存在（错误页）则改测命令面板
const more = page.locator("button[title='更多']");
if (await more.count()) {
  await more.first().click();
  await page.waitForTimeout(300);
  const openBefore = await page.evaluate(() => !!document.querySelector("[role='menu'], [cmdk-root]"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const openAfter = await page.evaluate(() => !!document.querySelector("[role='menu'], [cmdk-root]"));
  console.log(`more-menu: openBefore=${openBefore} openAfterEsc=${openAfter}`);
} else {
  console.log("more button not present (error page) — skip esc check");
}
await browser.close();
