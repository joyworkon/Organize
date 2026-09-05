import { chromium } from "@playwright/test";
import path from "path";
const out = "/tmp/d05-shots";
const browser = await chromium.launch();
const results = [];

const VIEWPORTS = [
  ["1440x900", 1440, 900],
  ["1366x768", 1366, 768],
  ["1024x768", 1024, 768],
  ["768x1024", 768, 1024],
  ["390x844", 390, 844],
  ["360x800", 360, 800],
];
const PAGES = [
  ["dash", "/"],
  ["notes", "/notes"],
  ["library", "/library"],
  ["tasks", "/tasks"],
  ["memos", "/memos"],
  ["settings", "/settings"],
];

const context = await browser.newContext();
const page = await context.newPage();
// 登录一次共享 cookie
await page.goto("http://127.0.0.1:3200/login");
await page.waitForTimeout(600);
const email = page.locator('input[type="email"], input[name="email"]').first();
if (await email.count()) {
  await email.fill("playwright-smoke@example.com");
  await page.locator('input[type="password"]').first().fill("playwright-smoke-password");
  await page.getByRole("button", { name: /登录|Sign in/i }).first().click();
  await page.waitForTimeout(1200);
}

for (const [vname, w, h] of VIEWPORTS) {
  await page.setViewportSize({ width: w, height: h });
  for (const [pname, url] of PAGES) {
    await page.goto(`http://127.0.0.1:3200${url}`);
    await page.evaluate(() => {
      localStorage.setItem("organize-theme", "light");
      localStorage.setItem("organize:onboarded", "1");
    });
    await page.reload();
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflowX = doc.scrollWidth - doc.clientWidth;
      // 找出溢出视口右侧的可见元素（前 3 个）
      const offenders = [];
      if (overflowX > 2) {
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (r.width > 0 && r.right > doc.clientWidth + 2 && style.visibility !== "hidden" && style.position !== "fixed") {
            offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
            if (offenders.length >= 3) break;
          }
        }
      }
      return { overflowX, clientW: doc.clientWidth, scrollW: doc.scrollWidth, offenders };
    });
    const status = m.overflowX > 2 ? "OVERFLOW" : "ok";
    results.push({ viewport: vname, page: pname, status, ...m });
    if (m.overflowX > 2) {
      await page.screenshot({ path: path.join(out, `overflow-${vname}-${pname}.png`) });
    }
  }
  // 每个视口留一张工作台 + 一张笔记详情代表截图
  await page.goto("http://127.0.0.1:3200/");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, `dash-${vname}.png`) });
}
console.log(JSON.stringify(results.filter(r => r.status !== "ok"), null, 1));
console.log("total checks:", results.length, "| failures:", results.filter(r => r.status !== "ok").length);
await browser.close();
