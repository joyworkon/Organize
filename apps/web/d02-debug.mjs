import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => { if (msg.type() === "error") console.log("[console.error]", msg.text().slice(0, 300)); });
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 500)));
await page.goto("http://127.0.0.1:3200/login");
await page.waitForTimeout(600);
const email = page.locator('input[type="email"], input[name="email"]').first();
if (await email.count()) {
  await email.fill("playwright-smoke@example.com");
  await page.locator('input[type="password"]').first().fill("playwright-smoke-password");
  await page.getByRole("button", { name: /登录|Sign in/i }).first().click();
  await page.waitForTimeout(1200);
}
await page.goto("http://127.0.0.1:3200/");
await page.evaluate(() => {
  localStorage.setItem("organize-theme", "light");
  localStorage.setItem("organize:theme-color", "orange");
  localStorage.setItem("organize:onboarded", "1");
});
await page.reload();
await page.waitForTimeout(1500);
console.log("URL:", page.url());
console.log("BODY text:", (await page.locator("body").innerText()).slice(0, 200));
await browser.close();
