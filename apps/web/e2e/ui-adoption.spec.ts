import { expect, test, type Page } from "@playwright/test";

// Production components with the existing mock backend, never the design prototype.
const routes = ["/", "/library", "/library?view=reading", "/library?view=memos", "/library?view=files", "/library?view=collections", "/notes", "/tasks?scope=all", "/tasks/calendar", "/tasks/countdown", "/tasks/lessons", "/tasks/search", "/canvas", "/favorites", "/tags", "/trash", "/graph", "/plugins", "/settings", "/shared", "/spaces", "/login", "/reset", "/s/missing-ui-audit", "/offline.html"];

async function ready(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText("加载中…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 430, height: 932 }, { width: 390, height: 844 }]) {
  for (const theme of ["light", "dark"] as const) {
    test(`all route families fit ${size.width}px ${theme}`, async ({ page }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((selected) => {
        localStorage.setItem("organize:onboarded", "1");
        localStorage.setItem("organize-theme", selected);
      }, theme);
      for (const route of routes) {
        await page.goto(route);
        await ready(page);
        await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })), { message: `${route}: no document-wide horizontal scrolling` }).toEqual({ width: size.width, viewport: size.width });
        if (route !== "/offline.html") await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor), { message: `${route}: persisted theme initializes directly` }).toBe(theme === "dark" ? "rgb(25, 25, 25)" : "rgb(255, 255, 255)");
        if (["/", "/tasks/calendar", "/library", "/settings"].includes(route)) {
          await page.screenshot({ path: info.outputPath(`${route === "/" ? "home" : route.slice(1).replaceAll("/", "-")}.png`) });
        }
      }
    });
  }
}

test("mobile drawer preserves task lists, routes and search focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/tasks?scope=all");
  await ready(page);
  await expect(page.locator(".mobile-context-bar")).toHaveCount(0);
  const open = page.getByRole("button", { name: "打开导航", exact: true });
  await open.click();
  const drawer = page.getByRole("dialog", { name: "应用导航", exact: true });
  await expect(drawer).toBeVisible();
  for (const name of ["工作台", "资料库", "笔记", "构思画布", "待办", "收藏夹", "垃圾箱", "设置"]) await expect(drawer.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "新建清单", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "搜索全部内容", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.locator("[cmdk-input]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
});

test("calendar modes, date popover and primary contrast stay coherent", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    localStorage.setItem("organize-theme", "dark");
  });
  await page.goto("/tasks/calendar");
  await ready(page);
  for (const name of ["日", "周", "月", "年"]) {
    const mode = page.getByRole("button", { name, exact: true });
    await mode.click();
    await expect(mode).toHaveAttribute("aria-pressed", "true");
    const bounds = await page.locator(".organize-calendar-screen").boundingBox();
    expect(bounds!.height).toBeGreaterThan(400);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: info.outputPath(`calendar-${name}.png`) });
  }
  await page.goto("/tasks?scope=all");
  await ready(page);
  await page.getByRole("button", { name: "完成 Organize 任务功能开发", exact: true }).click();
  const detail = page.locator(".organize-task-detail");
  await expect(detail).toBeVisible();
  // The trigger includes the actual stored date; match its existing semantic class.
  await detail.locator("button").filter({ hasText: /月.*日|设置日期/ }).first().click();
  await expect(page.getByRole("button", { name: "确定", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("date-popover-dark.png") });
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const dates = page.getByRole("dialog").locator(".grid-cols-7 > button");
    await expect(dates).toHaveCount(42);
    // The existing popover zoom-in animation briefly scales hit rectangles.
    await expect.poll(() => dates.first().evaluate((button) => button.getBoundingClientRect().height)).toBe(44);
    const bounds = await dates.evaluateAll((buttons) => buttons.slice(0, 7).map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, height: rect.height };
    }));
    for (let index = 0; index < bounds.length; index++) {
      expect(bounds[index].height).toBeGreaterThanOrEqual(44);
      expect(bounds[index].right).toBeLessThanOrEqual(width);
      if (index) expect(bounds[index].left).toBeGreaterThanOrEqual(bounds[index - 1].right - 0.1);
    }
  }
  await page.keyboard.press("Escape");
});

test("note title reflows after desktop/mobile resize without changing text", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes");
  await page.getByRole("heading", { name: "Cairn 设计系统落地清单", exact: true }).click();
  const title = page.getByPlaceholder("无标题笔记", { exact: true });
  await expect(title).toHaveValue("Cairn 设计系统落地清单");
  for (const width of [320, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => title.evaluate((element: HTMLTextAreaElement) => element.scrollHeight - element.clientHeight), { message: `title not clipped at ${width}px` }).toBeLessThanOrEqual(1);
    await expect(title).toHaveValue("Cairn 设计系统落地清单");
  }
});
