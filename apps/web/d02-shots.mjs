import { chromium } from "@playwright/test";
import path from "path";
const out = "/tmp/d02-shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 登录一次（cookie 存储于 context）
await page.goto("http://127.0.0.1:3200/login");
await page.waitForTimeout(600);
const email = page.locator('input[type="email"], input[name="email"]').first();
if (await email.count()) {
  await email.fill("playwright-smoke@example.com");
  await page.locator('input[type="password"]').first().fill("playwright-smoke-password");
  await page.getByRole("button", { name: /登录|Sign in/i }).first().click();
  await page.waitForTimeout(1200);
}

async function themed(name, theme, brand, url) {
  await page.goto(url);
  // 走应用真实存储：organize-theme（明暗）+ organize:theme-color（品牌）+ 跳过引导
  await page.evaluate(([t, b]) => {
    localStorage.setItem("organize-theme", t);
    localStorage.setItem("organize:theme-color", b);
    localStorage.setItem("organize:onboarded", "1");
    document.documentElement.classList.toggle("dark", t === "dark");
  }, [theme, brand]);
  await page.reload();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(out, name) });
  console.log("saved", name);
}

const dash = "http://127.0.0.1:3200/";
await themed("d02-dash-light-orange.png", "light", "orange", dash);
await themed("d02-dash-dark-orange.png", "dark", "orange", dash);
await themed("d02-dash-light-blue.png", "light", "blue", dash);
await themed("d02-dash-dark-green.png", "dark", "green", dash);
const notes = "http://127.0.0.1:3200/notes";
await themed("d02-notes-light-orange.png", "light", "orange", notes);
await themed("d02-notes-dark-purple.png", "dark", "purple", notes);
await browser.close();
