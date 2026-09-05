import { chromium } from "@playwright/test";
import path from "path";
const out = "/tmp/d04-shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:3200/login");
await page.waitForTimeout(600);
const email = page.locator('input[type="email"], input[name="email"]').first();
if (await email.count()) {
  await email.fill("playwright-smoke@example.com");
  await page.locator('input[type="password"]').first().fill("playwright-smoke-password");
  await page.getByRole("button", { name: /登录|Sign in/i }).first().click();
  await page.waitForTimeout(1200);
}
await page.goto("http://127.0.0.1:3200/notes/notes-hz5ou838");
await page.evaluate(() => {
  localStorage.setItem("organize-theme", "light");
  localStorage.setItem("organize:onboarded", "1");
});
await page.reload();
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(out, "d04-note-light-1440.png") });
console.log("saved base");
// 更多菜单 → 目录（互斥面板）
await page.locator("button[title=更多]").first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, "d04-note-more-menu.png") });
console.log("saved more menu");
const tocItem = page.getByRole("menuitem", { name: /目录/ }).first();
if (await tocItem.count()) await tocItem.click();
else await page.locator("text=目录").first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, "d04-note-toc-280.png") });
console.log("saved toc");
const width = await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll("div")).find((d) => String(d.className).includes("max-w-[760px]"));
  return el ? getComputedStyle(el).maxWidth : "not-found";
});
console.log("content max-width:", width);
const tocW = await page.evaluate(() => {
  const el = document.querySelector(".note-toc");
  return el ? getComputedStyle(el).width : "not-found";
});
console.log("toc width:", tocW);
await browser.close();
