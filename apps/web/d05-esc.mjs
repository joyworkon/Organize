import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto("http://127.0.0.1:3200/login");
await page.waitForTimeout(600);
const email = page.locator('input[type="email"], input[name="email"]').first();
if (await email.count()) {
  await email.fill("playwright-smoke@example.com");
  await page.locator('input[type="password"]').first().fill("playwright-smoke-password");
  await page.getByRole("button", { name: /登录|Sign in/i }).first().click();
  await page.waitForTimeout(1200);
}
await page.goto("http://127.0.0.1:3200/notes");
await page.evaluate(() => {
  localStorage.setItem("organize-theme", "light");
  localStorage.setItem("organize:onboarded", "1");
});
await page.reload();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /新建笔记/ }).first().click();
await page.waitForTimeout(1800);
// 更多菜单 Esc → 关闭 + 焦点回归触发器
await page.locator("button[title='更多']").first().click();
await page.waitForTimeout(300);
const searchFocused = await page.evaluate(() => !!document.activeElement?.closest("[cmdk-root], [role='menu']"));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const menuGone = await page.evaluate(() => !document.querySelector("[cmdk-root]"));
const focusBack = await page.evaluate(() => document.activeElement?.getAttribute("title") === "更多");
console.log(`更多菜单: 打开时焦点在菜单内=${searchFocused} Esc后菜单关闭=${menuGone} 焦点回归触发器=${focusBack}`);
// 移动抽屉：390 视口开抽屉 → Esc/遮罩关闭
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:3200/");
await page.waitForTimeout(900);
const hamburger = page.locator("header button").first();
await hamburger.click();
await page.waitForTimeout(400);
const drawerOpen = await page.evaluate(() => !!document.querySelector(".fixed.inset-0"));
console.log("drawer open:", drawerOpen);
if (drawerOpen) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  let stillOpen = await page.evaluate(() => !!document.querySelector(".fixed.inset-0"));
  console.log("drawer after Esc:", stillOpen);
  if (stillOpen) {
    // 点遮罩关闭
    await page.locator(".fixed.inset-0").first().click({ position: { x: 20, y: 400 } });
    await page.waitForTimeout(300);
    stillOpen = await page.evaluate(() => !!document.querySelector(".fixed.inset-0"));
    console.log("drawer after overlay click:", stillOpen);
  }
}
await browser.close();
