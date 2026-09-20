import { expect, test, type Page } from "@playwright/test";

/**
 * 构思画布 E2E（idea-canvas，docs/idea-canvas-plan.md §8）。
 *
 * mock 模式：文档落在页面内存库（api-shim → mockDb），整页 reload 后重置为
 * 种子数据；草稿在 IndexedDB，可跨 reload 恢复。因此「远端仍在 + 草稿领先」
 * 的横幅流程无法在 reload 后复现（远端会先消失），mock 下诚实可验证的是：
 * reload → 文档 404 → 「把本机草稿另存为新画布」→ 内容完整带出。
 * 断言覆盖：双击建版面（多缩放档位）、Enter 通栏、左右增列、局部加号、
 * 等高与跨层、撤销、保存状态、草稿恢复、垃圾箱删除/恢复。
 */

/** 视口默认 pan = (40, 40)（canvas-store 初始值）。 */
const PAN_X = 40;
const PAN_Y = 40;

async function openPage(page: Page, path: string) {
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  });
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
}

async function openNewCanvas(page: Page) {
  await openPage(page, "/canvas");
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
}

async function dblClickViewport(page: Page, x: number, y: number) {
  await page.getByTestId("canvas-viewport").dblclick({ position: { x, y } });
}

function boardStyle(page: Page) {
  return page
    .locator("[data-board-id]")
    .first()
    .getAttribute("style")
    .then((style) => ({
      left: Number(/left: (-?[\d.]+)px/.exec(style!)![1]),
      top: Number(/top: (-?[\d.]+)px/.exec(style!)![1]),
      width: Number(/width: ([\d.]+)px/.exec(style!)![1]),
    }));
}

/** 真实渲染矩形（相对版面左上角）——CSS 等高/通栏必须用渲染结果验证，不能只读 style。 */
async function blockRect(page: Page, index: number) {
  const board = page.locator("[data-board-id]").first();
  const el = page.locator("[data-block-id]").nth(index);
  await expect(el).toBeVisible();
  const rects = await page.evaluate(
    ([boardEl, blockEl]) => {
      const b = (boardEl as HTMLElement).getBoundingClientRect();
      const r = (blockEl as HTMLElement).getBoundingClientRect();
      return { left: r.left - b.left, top: r.top - b.top, width: r.width, height: r.height };
    },
    [await board.elementHandle(), await el.elementHandle()],
  );
  return rects;
}

test.describe("构思画布", () => {
  test("新建后进入编辑器，保存状态如实标注演示模式", async ({ page }) => {
    await openNewCanvas(page);
    await expect(page.getByTestId("canvas-save-status")).toContainText("演示");
  });

  test("双击建版面（100%）：出现在点击世界坐标，标题可输入（A01）", async ({ page }) => {
    await openNewCanvas(page);
    await dblClickViewport(page, 300, 260);
    const board = page.locator("[data-board-id]").first();
    await expect(board).toBeVisible();
    // 世界坐标 = 屏幕坐标 - pan（zoom=1）
    const { left, top, width } = await boardStyle(page);
    expect(left).toBe(300 - PAN_X);
    expect(top).toBe(260 - PAN_Y);
    expect(width).toBe(640); // 初始设计宽
    const title = page.locator("[data-block-type='text'] textarea").first();
    await expect(title).toBeFocused();
    await page.keyboard.type("画布标题");
    await expect(title).toHaveValue("画布标题");
  });

  test("标题输入 → Enter 通栏 → 左右加号 → 局部加号（A02–A04 布局边界）", async ({ page }) => {
    await openNewCanvas(page);
    // x=100：让版面右缘远离右侧属性栏，避免悬浮面板遮挡加号
    await dblClickViewport(page, 100, 150);
    const titleArea = page.locator("[data-block-type='text'] textarea").first();
    await expect(titleArea).toBeFocused();
    await page.keyboard.type("标题甲乙丙");
    await page.keyboard.press("Enter"); // 标题分区下新增通栏

    const titleBefore = await blockRect(page, 0);
    expect(titleBefore.width).toBe(640 - 24 * 2); // 标题满内容宽

    await page.keyboard.type("正文第一段");
    await page.keyboard.press("Enter"); // 正文下再插一个通栏

    // 悬停最新通栏的块 → 右侧加号 → 变两列
    const blocks = page.locator("[data-block-type='text']");
    const countBefore = await blocks.count();
    const last = blocks.nth(countBefore - 1);
    await last.hover();
    const rightPlus = page.locator("button[aria-label='在右侧添加一列']").first();
    await expect(rightPlus).toBeVisible();
    await rightPlus.click();
    // 等新块（新列）出现
    await expect(blocks).toHaveCount(countBefore + 1);

    // 两列：列宽之和 + 间距 = 标题内容宽；标题宽度不变（A02）
    const titleAfter = await blockRect(page, 0);
    expect(titleAfter.width).toBe(titleBefore.width);
    const count = countBefore + 1;
    const colA = await blockRect(page, count - 2);
    const colB = await blockRect(page, count - 1);
    expect(colA.width + 16 + colB.width).toBeCloseTo(titleAfter.width, 0);

    // 左列局部加号：左列两块等高、右列单块跨两层（A04）
    await blocks.nth(count - 2).hover();
    const belowPlus = page.locator("button[aria-label='在本列下方添加模块']").first();
    await expect(belowPlus).toBeVisible();
    await belowPlus.click();
    const blocks2 = page.locator("[data-block-type='text']");
    await expect(blocks2).toHaveCount(count + 1); // 左列新增一块，右列不变
    const n = count + 1;
    const leftTop = await blockRect(page, n - 3);
    const leftBottom = await blockRect(page, n - 2);
    const rightSingle = await blockRect(page, n - 1);
    expect(leftTop.height).toBeCloseTo(leftBottom.height, 0);
    expect(rightSingle.height).toBeCloseTo(leftTop.height * 2 + 16, 0);
  });

  test("缩放到约 200% 后双击：新版面落在点击的世界坐标（A01）", async ({ page }) => {
    await openNewCanvas(page);
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole("button", { name: "放大" }).click();
    }
    await expect(page.locator(".canvas-zoom-value")).toHaveText(/\d{3}%/);
    await dblClickViewport(page, 400, 300);
    const board = page.locator("[data-board-id]").first();
    await expect(board).toBeVisible();
    const zoomText = await page.locator(".canvas-zoom-value").textContent();
    const zoom = Number(zoomText!.replace("%", "")) / 100;
    const { left, top } = await boardStyle(page);
    // 世界坐标 = (屏幕坐标 - pan) / zoom
    expect(left).toBeCloseTo((400 - PAN_X) / zoom, 0);
    expect(top).toBeCloseTo((300 - PAN_Y) / zoom, 0);
  });

  test("撤销（⌘Z）：连续结构编辑后原子回退（A09）", async ({ page }) => {
    await openNewCanvas(page);
    await dblClickViewport(page, 100, 150);
    await page.keyboard.type("T");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    const sections = () => page.locator("[data-section-id]").count();
    const before = await sections();
    expect(before).toBeGreaterThanOrEqual(3);
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(200);
    expect(await sections()).toBe(before - 1);
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(200);
    expect(await sections()).toBe(before - 2);
  });

  test("mock 保存与草稿恢复：远端缺失时本机草稿可另存为新画布（A15 可自动化部分）", async ({ page }) => {
    // Playwright 的 Chromium 上下文里 IndexedDB 不跨 reload 持久化（实测），
    // 因此用 addInitScript 在文档创建时注入草稿（写入侧由 draft.test.ts 单测覆盖），
    // 然后直接打开一个不存在的文档 ID：远端 404 + 草稿领先 → 恢复链路。
    const missingId = "00000000-0000-4000-8000-00000000dead";
    await page.addInitScript(() => {
      window.localStorage.setItem("organize:onboarded", "1");
    });
    await page.addInitScript(([id]) => {
      const doc = {
        schemaVersion: 1,
        boards: [
          {
            id: "b-draft",
            x: 0,
            y: 0,
            width: 640,
            padding: 24,
            gap: 16,
            sections: [
              {
                id: "s-draft",
                widthMode: "equal",
                columnWeights: [1],
                columns: [
                  {
                    id: "c-draft",
                    blocks: [{ id: "k-draft", type: "text", text: "草稿恢复验证", role: "title" }],
                  },
                ],
              },
            ],
          },
        ],
        freeItems: [],
      };
      const draft = {
        docId: id,
        userId: "mock-user-0001",
        title: "草稿恢复验证",
        doc,
        savedRevision: 1,
        localSeq: 9,
        updatedAt: Date.now(),
      };
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("organize-canvas", 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
            if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      openDb().then((db) => {
        const tx = db.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put(draft, `mock-user-0001:${id}`);
      });
    }, [missingId]);
    await page.goto(`/canvas/${missingId}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
    await expect(page.getByText("找不到这个画布文档")).toBeVisible();
    await page.getByRole("button", { name: "把本机草稿另存为新画布" }).click();
    await expect(page.locator(".canvas-text-content").first()).toContainText("草稿恢复验证", {
      timeout: 15000,
    });
  });

  test("删除文档进垃圾箱，可在垃圾箱恢复（A13 可自动化部分，SPA 导航保持内存库）", async ({ page }) => {
    await openPage(page, "/canvas");
    await page.getByRole("button", { name: "新建构思画布" }).first().click();
    await page.waitForURL(/\/canvas\//);
    await page.waitForTimeout(800);
    // SPA 导航回列表（内存库不清空）
    await page.getByRole("link", { name: "返回画布列表" }).click();
    const card = page.locator(".canvas-list-card").first();
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /删除/ }).click();
    await expect(page.getByText("已移入垃圾箱")).toBeVisible();
    // 侧栏 SPA 进垃圾箱
    await page.getByRole("link", { name: "垃圾箱" }).first().click();
    await page.waitForURL(/\/trash/);
    await page.getByRole("tab", { name: "画布" }).click();
    await expect(page.getByText("未命名画布").first()).toBeVisible();
    await page.getByRole("button", { name: "恢复" }).first().click();
    await expect(page.getByText("未命名画布")).toHaveCount(0);
    // 回列表确认恢复
    await page.getByRole("link", { name: "构思画布" }).click();
    await expect(page.locator(".canvas-list-card").first()).toBeVisible();
  });
});
