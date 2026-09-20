import { test, expect, type Page } from "@playwright/test";
async function openPage(page: Page, path: string) {
  await page.addInitScript(() => { window.localStorage.setItem("organize:onboarded", "1"); });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}
test("dbg board height 2", async ({ page }) => {
  await openPage(page, "/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.getByTestId("canvas-viewport").dblclick({ position: { x: 80, y: 120 } });
  await page.keyboard.type("新品发布 · 内容卡片");
  await page.keyboard.press("Enter");
  await page.keyboard.type("左列正文：把想法写下来，让版式自己长出来。双击即建，回车成栏。");
  await page.waitForTimeout(500);
  const audit = await page.evaluate(() => {
    const board = document.querySelector("[data-board-id]") as HTMLElement;
    const blocks = [...document.querySelectorAll("[data-block-id]")].map((el) => {
      const s = (el as HTMLElement).style;
      return { top: s.top, h: s.height, text: (el.textContent || "").slice(0, 12) };
    });
    return { boardH: board.style.height, blocks };
  });
  console.log("AUDIT2:", JSON.stringify(audit));
});
