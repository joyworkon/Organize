import { expect, test, type Page } from "@playwright/test";

/**
 * 构思画布「导出页面为 PNG」：
 * - 不真实落盘：spy URL.createObjectURL（记录 PNG blob 类型/大小）与
 *   HTMLAnchorElement.click（记录 download 文件名并拦截）。
 * - 成功 toast、文件名清洗（{画布标题}-{页面名}.png）、预览模式可导出。
 */

async function installDownloadSpy(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("organize:onboarded", "1");
    const w = window as unknown as {
      __pngExports: { type: string; size: number }[];
      __downloads: { name: string }[];
    };
    w.__pngExports = [];
    w.__downloads = [];
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      w.__pngExports.push({ type: blob?.type ?? "", size: blob?.size ?? 0 });
      return origCreate(blob);
    };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) {
        w.__downloads.push({ name: this.download });
        return;
      }
      return origClick.call(this);
    };
  });
}

async function openCanvas(page: Page) {
  await installDownloadSpy(page);
  await page.goto("/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
}

async function createBlankBoard(page: Page) {
  await page.getByRole("button", { name: "新建空白页面", exact: true }).click();
  const titleBox = page.locator("[data-block-id] textarea");
  await expect(titleBox).toBeFocused();
  await titleBox.fill("导出验收标题");
  await page.keyboard.press("Escape");
}

/** 等一次导出完成：返回下载文件名与 PNG blob 描述。 */
async function waitForExport(page: Page) {
  await page.waitForFunction(
    () => (window as unknown as { __downloads: unknown[] }).__downloads.length > 0,
    undefined,
    { timeout: 15000 },
  );
  return page.evaluate(() => {
    const w = window as unknown as {
      __downloads: { name: string }[];
      __pngExports: { type: string; size: number }[];
    };
    return {
      name: w.__downloads[0]?.name ?? "",
      png: w.__pngExports.filter((entry) => entry.type === "image/png").at(-1) ?? null,
    };
  });
}

test("选中页面后属性栏一键导出 PNG，成功提示与文件名正确（1440 视口）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCanvas(page);
  await createBlankBoard(page);

  // 压一张自由便签在画布上（导出面走自由元素渲染路径）
  await page.getByRole("button", { name: "自由放置", exact: true }).click();
  await page.getByRole("button", { name: "新建便签", exact: true }).click();
  await page.keyboard.press("Escape");

  // 经大纲选中第一页 → 右侧属性栏出现「导出 PNG」
  await page.getByRole("button", { name: "结构", exact: true }).click();
  await page.getByRole("button", { name: "页面：页面 1", exact: true }).click();
  const exportButton = page
    .locator(".canvas-property-bar")
    .getByRole("button", { name: "导出页面为 PNG", exact: true });
  await expect(exportButton).toBeVisible();
  await exportButton.click();

  const result = await waitForExport(page);
  expect(result.name).toBe("未命名画布-未命名页面.png");
  expect(result.png).not.toBeNull();
  // 非空白兜底：纯背景 PNG 不足 3KB；含卡片/文字/便签的页面明显更大
  expect(result.png!.size).toBeGreaterThan(3000);
  await expect(page.getByText("已导出 PNG")).toBeVisible();
});

test("大纲行内导出按钮无需先选中，页面名进入文件名", async ({ page }) => {
  await openCanvas(page);
  await createBlankBoard(page);

  await page.getByRole("button", { name: "结构", exact: true }).click();
  const outline = page.locator(".canvas-outline-row.is-board");
  await outline.getByRole("button", { name: "重命名页面 页面 1", exact: true }).click();
  const nameBox = page.getByRole("textbox", { name: "页面名称", exact: true });
  await nameBox.fill("发布会封面");
  await nameBox.press("Enter");

  await outline.getByRole("button", { name: "导出页面 发布会封面 为 PNG", exact: true }).click();
  const result = await waitForExport(page);
  expect(result.name).toBe("未命名画布-发布会封面.png");
  expect(result.png).not.toBeNull();
});

test("预览模式仍可经翻页指示条导出当前页", async ({ page }) => {
  await openCanvas(page);
  await createBlankBoard(page);
  // 复制出两页并回选第一页，预览落页确定
  await page.getByRole("button", { name: "结构", exact: true }).click();
  const outline = page.locator(".canvas-outline-row.is-board");
  await outline.getByRole("button", { name: "重命名页面 页面 1", exact: true }).click();
  const nameBox = page.getByRole("textbox", { name: "页面名称", exact: true });
  await nameBox.fill("第一页");
  await nameBox.press("Enter");
  await outline.getByRole("button", { name: "复制页面 第一页", exact: true }).click();
  await expect(page.locator(".canvas-board")).toHaveCount(2);
  await page.getByRole("button", { name: "页面：第一页", exact: true }).click();

  await page.getByRole("button", { name: "预览", exact: true }).click();
  const pager = page.getByTestId("canvas-preview-pager");
  await expect(pager).toContainText("第 1 / 2 页");
  await pager.getByRole("button", { name: "导出页面为 PNG", exact: true }).click();

  const result = await waitForExport(page);
  expect(result.name).toBe("未命名画布-第一页.png");
  expect(result.png).not.toBeNull();
});
