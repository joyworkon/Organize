import { chromium } from "@playwright/test";
import path from "path";
const out = "/tmp/d06-shots";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto("http://127.0.0.1:3200/login");
await page.waitForTimeout(600);
await page.locator('input[type="email"], input[name="email"]').first().fill("r12-perf@test.local");
await page.locator('input[type="password"]').first().fill("r12-perf-password");
await page.getByRole("button", { name: /登录|Sign in/i }).first().click();
await page.waitForTimeout(2000);
const PAGES = [
  ["library", "/library"],
  ["tasks", "/tasks"],
  ["memos", "/memos"],
  ["favorites", "/favorites"],
  ["trash", "/trash"],
  ["settings", "/settings"],
  ["plugins", "/plugins"],
  ["graph", "/graph"],
  ["stats", "/?view=stats"],
];
for (const [name, url] of PAGES) {
  for (const theme of ["light", "dark"]) {
    await page.goto(`http://127.0.0.1:3200${url}`);
    await page.evaluate((t) => {
      const stale = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("organize:offline") || key.startsWith("organize:note-draft"))) stale.push(key);
      }
      stale.forEach((key) => localStorage.removeItem(key));
      localStorage.setItem("organize-theme", t);
      localStorage.setItem("organize:onboarded", "1");
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    await page.reload();
    await page.waitForTimeout(1100);
    const m = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    await page.screenshot({ path: path.join(out, `d06-${name}-${theme}.png`) });
    if (m.overflowX > 2) console.log(`OVERFLOW ${name} ${theme}: ${m.overflowX}px`);
  }
}
console.log("sweep done");
await browser.close();
