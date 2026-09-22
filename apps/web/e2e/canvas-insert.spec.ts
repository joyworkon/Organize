import { expect, test, type Page } from "@playwright/test";

/**
 * 构思画布 B2 E2E：统一插入规则 / 图片统一流程 / 新块类型 / 属性栏补全。
 *
 * mock 模式（内存文档 + IndexedDB 本机图片）。上传延时经
 * window.__canvasMockUploadDelayMs 注入（仅 mock 路径生效），用于在途行为验证。
 */

/** 1×1 PNG。 */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function openNewCanvas(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("organize:onboarded", "1");
  });
  await page.goto("/canvas");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "新建构思画布" }).first().click();
  await page.waitForURL(/\/canvas\//);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
}

/** 双击建空白页面骨架（一个区块 + 标题块，标题聚焦）。 */
async function createBlankBoard(page: Page, x = 400, y = 150) {
  await page.getByTestId("canvas-viewport").dblclick({ position: { x, y } });
  const title = page.locator("[data-block-type='text'] textarea").first();
  await expect(title).toBeFocused();
}

async function pickImageViaPanel(page: Page) {
  await page.getByRole("button", { name: "添加图片" }).click();
  await page.getByTestId("canvas-image-input").setInputFiles({
    name: "panel.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });
}

/** 在视口指定屏幕坐标派发文件拖入。 */
async function dispatchDrop(page: Page, clientX: number, clientY: number, name: string) {
  await page.evaluate(
    ({ x, y, fileName, b64 }: { x: number; y: number; fileName: string; b64: string }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], fileName, { type: "image/png" }));
      const el = document.querySelector("[data-testid='canvas-viewport']")!;
      el.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
      );
    },
    { x: clientX, y: clientY, fileName: name, b64: PNG_BASE64 },
  );
}

/** 在视口上派发图片粘贴（落点 = 最近指针世界坐标）。 */
async function dispatchPaste(page: Page, name: string) {
  await page.evaluate(
    ({ fileName, b64 }: { fileName: string; b64: string }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], fileName, { type: "image/png" }));
      const el = document.querySelector("[data-testid='canvas-viewport']")!;
      el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    },
    { fileName: name, b64: PNG_BASE64 },
  );
}

test.describe("构思画布 B2：统一插入", () => {
  test("落地页骨架：头部加标题+正文+图片，全部属于头部容器（DOM 归属）", async ({ page }) => {
    await openNewCanvas(page);
    await page.getByRole("button", { name: "新建宣传落地页骨架" }).click();
    await expect(page.locator("[data-region-id]")).toHaveCount(3);
    const head = page.locator("[data-region-id]").nth(0);
    const middle = page.locator("[data-region-id]").nth(1);
    // 选中头部标题块 → 面板依次添加
    await page.locator("[data-block-id]").first().click();
    await page.getByRole("button", { name: "添加正文" }).click();
    await page.getByRole("button", { name: "添加标题" }).click();
    await pickImageViaPanel(page);
    // 三块新内容全部落在头部容器内；中部/底部没有块
    await expect(head.locator("[data-block-id]")).toHaveCount(4);
    await expect(middle.locator("[data-block-id]")).toHaveCount(1);
    await expect(page.locator("[data-block-type='image']")).toHaveCount(1);
    await expect(head.locator("[data-block-type='image']")).toHaveCount(1);
  });

  test("目标提示随解析规则更新：空白→新页面，选中块→区块名", async ({ page }) => {
    await openNewCanvas(page);
    await expect(page.getByTestId("canvas-insert-hint")).toHaveText("添加到：新页面");
    await createBlankBoard(page);
    // 标题块聚焦（编辑态）→ 目标 = 其所在区块「内容」
    await expect(page.getByTestId("canvas-insert-hint")).toHaveText("添加到：内容");
  });

  test("图片三入口：按钮选择/拖入/粘贴都落在目标列", async ({ page }) => {
    await openNewCanvas(page);
    await createBlankBoard(page);
    await page.keyboard.type("标题");
    await page.keyboard.press("Enter");
    await page.keyboard.type("正文");
    // 造两列正文行：悬停正文块 → 右侧加号（骨架 1 列 + 新列 = 2；标题列另计）
    await page.locator("[data-block-type='text']").nth(1).hover();
    await page.locator("button[aria-label='在右侧添加一列']").first().click();
    await expect(page.locator("[data-column-id]")).toHaveCount(3);

    // 入口 1：面板按钮 + 文件选择（选中左列块）
    await page.locator("[data-block-type='text']").nth(1).click();
    await pickImageViaPanel(page);
    await expect(page.locator("[data-block-type='image']")).toHaveCount(1);
    const leftColumn = page.locator("[data-column-id]").nth(1);
    await expect(leftColumn.locator("[data-block-type='image']")).toHaveCount(1);

    // 入口 2：拖入左列（指针命中左列块 → 其后）
    const leftBlock = page.locator("[data-block-type='text']").nth(1);
    const box = (await leftBlock.boundingBox())!;
    await dispatchDrop(page, box.x + box.width / 2, box.y + box.height / 2, "drag.png");
    await expect(page.locator("[data-block-type='image']")).toHaveCount(2);
    await expect(leftColumn.locator("[data-block-type='image']")).toHaveCount(2);

    // 入口 3：粘贴（指针先移到右列 → 世界坐标命中右列；取列内靠上偏左，
    // 避免右侧属性栏遮挡与列块拉伸后中心点超出视口）
    const rightBlock = page.locator("[data-column-id]").nth(2).locator("[data-block-id]").first();
    const rbox = (await rightBlock.boundingBox())!;
    await page.mouse.move(rbox.x + 20, rbox.y + 26);
    await dispatchPaste(page, "paste.png");
    await expect(page.locator("[data-block-type='image']")).toHaveCount(3);
    const rightColumn = page.locator("[data-column-id]").nth(2);
    await expect(rightColumn.locator("[data-block-type='image']")).toHaveCount(1);
  });

  test("区块间隙加号：在两个区块之间插入新区块", async ({ page }) => {
    await openNewCanvas(page);
    await page.getByRole("button", { name: "新建宣传落地页骨架" }).click();
    const gap = page.locator(".canvas-region-gap").nth(0);
    await gap.hover();
    await gap.getByRole("button", { name: "在下方添加区块" }).click();
    await expect(page.locator("[data-region-id]")).toHaveCount(4);
  });

  test("平移远离原点后经添加面板新建，新内容进入可视区", async ({ page }) => {
    await openNewCanvas(page);
    await createBlankBoard(page);
    // 平移到远处（中键拖拽平移，滚轮在合成事件下受系统滚动方向设置影响）
    await page.mouse.move(600, 400);
    await page.mouse.down({ button: "middle" });
    for (let i = 1; i <= 12; i += 1) await page.mouse.move(600, 400 + i * 80);
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(200);
    const boardBoxBefore = await page.locator("[data-board-id]").first().boundingBox();
    const viewportBox = await page.getByTestId("canvas-viewport").boundingBox();
    // 已平出视口（与视口无交叠，上方或下方均可）
    const beforeVisible =
      boardBoxBefore!.y < viewportBox!.y + viewportBox!.height &&
      boardBoxBefore!.y + boardBoxBefore!.height > viewportBox!.y;
    expect(beforeVisible).toBe(false);
    // 无选中 → lastActive（最近区块）→ 插入并自动带回可视区
    await page.getByRole("button", { name: "添加正文" }).click();
    const boardBoxAfter = await page.locator("[data-board-id]").first().boundingBox();
    expect(boardBoxAfter).not.toBeNull();
    const viewport = await page.getByTestId("canvas-viewport").boundingBox();
    expect(boardBoxAfter!.y + boardBoxAfter!.height).toBeGreaterThan(viewport!.y);
    expect(boardBoxAfter!.y).toBeLessThan(viewport!.y + viewport!.height);
  });

  test("新块类型：分隔线/列表渲染与行为", async ({ page }) => {
    await openNewCanvas(page);
    await createBlankBoard(page);
    await page.keyboard.type("T");
    await page.getByRole("button", { name: "添加分隔线" }).click();
    await expect(page.locator("[data-block-type='divider']")).toHaveCount(1);
    await page.getByRole("button", { name: "添加列表" }).click();
    // 列表块进入编辑态（文本块聚焦）
    const listTa = page.locator("[data-block-type='text'][data-text-role='list'] textarea");
    await expect(listTa).toBeFocused();
    await page.keyboard.type("第一条");
    await page.keyboard.press("Enter"); // Enter = 区块末尾新通栏行（与正文一致）
    const sections = page.locator("[data-section-id]");
    await expect(sections).toHaveCount(2);
  });

  test("行动按钮：编辑态点击=选中，预览态才是链接", async ({ page }) => {
    await openNewCanvas(page);
    await createBlankBoard(page);
    await page.getByRole("button", { name: "添加行动按钮" }).click();
    const btn = page.locator("[data-block-type='button']");
    await expect(btn).toHaveCount(1);
    // 编辑态：渲染为禁用 span（href 未设置），点击 = 选中
    await expect(btn.locator("span.canvas-btn.is-disabled")).toHaveCount(1);
    await expect(btn.locator("a.canvas-btn")).toHaveCount(0);
    await btn.click();
    await expect(page.getByRole("heading", { name: "行动按钮" })).toBeVisible();
    // 属性栏填写链接
    await page.getByLabel("按钮链接").fill("https://example.com/cta");
    // 编辑态点击仍不导航、不渲染链接
    await expect(btn.locator("a.canvas-btn")).toHaveCount(0);
    await btn.click();
    await expect(page).toHaveURL(/\/canvas\//);
    // 预览态：渲染为可点链接，点击新开标签页
    await page.getByRole("button", { name: "预览", exact: true }).click();
    const link = btn.locator("a.canvas-btn");
    await expect(link).toHaveAttribute("href", "https://example.com/cta");
    const popupPromise = page.waitForEvent("popup");
    await link.click();
    const popup = await popupPromise;
    expect(popup.url()).toContain("example.com");
    await popup.close();
  });
});

test.describe("构思画布 B2：加号与悬停预览（多缩放）", () => {
  test("50%/100%/200% 缩放下加号与预览位置一致", async ({ page }) => {
    await openNewCanvas(page);
    await createBlankBoard(page);
    const viewport = page.getByTestId("canvas-viewport");
    const vbox = (await viewport.boundingBox())!;

    async function zoomBy(factor: number) {
      // Ctrl/⌘+滚轮围绕指针缩放（exp(-deltaY*0.002)）
      const deltaY = factor > 1 ? -347 : 347;
      await page.keyboard.down("Control");
      await page.mouse.move(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
      await page.mouse.wheel(0, deltaY);
      await page.keyboard.up("Control");
      await page.waitForTimeout(200);
    }

    for (const target of [0.5, 1, 2]) {
      await zoomBy(target > 1 ? 2 : 0.5);
      await page.waitForTimeout(150);
      // 连续调整直到接近目标档位（指数步进）
      for (let guard = 0; guard < 6; guard += 1) {
        const text = await page.locator(".canvas-zoom-value").textContent();
        const zoom = Number(text!.replace("%", "")) / 100;
        if (Math.abs(zoom - target) / target < 0.12) break;
        await zoomBy(zoom > target ? 0.5 : 2);
      }
      const text = await page.locator(".canvas-zoom-value").textContent();
      const zoom = Number(text!.replace("%", "")) / 100;
      expect(Math.abs(zoom - target) / target).toBeLessThan(0.12);

      // 悬停首块 → 块下加号；悬停加号 → 预览
      const block = page.locator("[data-block-id]").first();
      await block.hover();
      const plus = page.locator("button[aria-label='在本列下方添加模块']").first();
      await expect(plus).toBeVisible();
      const b = (await block.boundingBox())!;
      const p = (await plus.boundingBox())!;
      expect(Math.abs(p.x + p.width / 2 - (b.x + b.width / 2))).toBeLessThan(2.5);
      await plus.hover();
      const ghost = page.locator(".canvas-insert-preview").first();
      await expect(ghost).toBeVisible();
      const g = (await ghost.boundingBox())!;
      expect(Math.abs(g.width - b.width)).toBeLessThan(2.5);
      // 预览顶 = 块底 + 半个块距（世界 gap/2 × zoom）
      expect(Math.abs(g.y - (b.y + b.height) - 8 * zoom)).toBeLessThan(2.5);
      // 悬停不写入文档：块数不变
      await expect(page.locator("[data-block-id]")).toHaveCount(1);
      await page.mouse.move(vbox.x + 4, vbox.y + 4);
    }
  });
});

test.describe("构思画布 B2：图片在途行为（mock 延时）", () => {
  test("上传中切换选区：图片仍落在快照目标列", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __canvasMockUploadDelayMs: number }).__canvasMockUploadDelayMs = 700;
    });
    await openNewCanvas(page);
    await createBlankBoard(page);
    await page.keyboard.type("甲");
    await page.keyboard.press("Enter");
    await page.keyboard.type("乙");
    // 选中「乙」块 → 面板图片（目标快照 = 乙之后）
    await page.locator("[data-block-type='text']").nth(1).click();
    await page.getByRole("button", { name: "添加图片" }).click();
    await page.getByTestId("canvas-image-input").setInputFiles({
      name: "slow.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });
    // 上传中：切换选区到标题块
    await expect(page.getByText("上传中…")).toBeVisible();
    await page.locator("[data-block-type='text']").nth(0).click();
    // 完成后图片仍在「乙」之后（同列），不受选区变化影响
    await expect(page.locator("[data-block-type='image']")).toHaveCount(1, { timeout: 8000 });
    await expect(page.getByText("上传中…")).toHaveCount(0);
    const images = page.locator("[data-column-id]").nth(1).locator("[data-block-type='image']");
    await expect(images).toHaveCount(1);
  });

  test("上传中删除占位：转「待重新放置」自由图片并提示，绝不插回", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __canvasMockUploadDelayMs: number }).__canvasMockUploadDelayMs = 700;
    });
    await openNewCanvas(page);
    await createBlankBoard(page);
    await page.getByRole("button", { name: "添加图片" }).click();
    await page.getByTestId("canvas-image-input").setInputFiles({
      name: "orphan.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });
    await expect(page.getByText("上传中…")).toBeVisible();
    // 删除占位块（当前选中 = 占位）
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-block-type='image']")).toHaveCount(0);
    // 迟到的完成：不插回，转为自由图片 + toast 提示
    await expect(page.locator("[data-free-item-id]")).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator("[data-block-type='image']")).toHaveCount(0);
    await expect(page.getByText(/待重新放置/)).toBeVisible();
  });

  test("上传中撤销占位插入：迟到的完成不插回，转自由图片", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __canvasMockUploadDelayMs: number }).__canvasMockUploadDelayMs = 700;
    });
    await openNewCanvas(page);
    await createBlankBoard(page);
    await page.getByRole("button", { name: "添加图片" }).click();
    await page.getByTestId("canvas-image-input").setInputFiles({
      name: "undone.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });
    await expect(page.getByText("上传中…")).toBeVisible();
    await page.keyboard.press("Meta+z"); // 撤销占位插入
    await expect(page.locator("[data-block-type='image']")).toHaveCount(0);
    await expect(page.locator("[data-free-item-id]")).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator("[data-block-type='image']")).toHaveCount(0);
  });

  test("替换图片：保留块位置与设置；ratio 锁高后 fit 控件出现", async ({ page }) => {
    await openNewCanvas(page);
    await createBlankBoard(page);
    await page.locator("[data-block-type='text']").first().click();
    await pickImageViaPanel(page);
    const image = page.locator("[data-block-type='image']");
    await expect(image).toHaveCount(1);
    // 1×1 PNG 的 auto 高 ≈ 方盒；切 4:3 后高 = 内宽×0.75 + chrome，应明显变矮
    await page.getByRole("radio", { name: "4:3" }).click();
    await page.waitForTimeout(250);
    const after = await image.boundingBox();
    expect(after!.height).toBeLessThan(after!.width - 50);
    // 定比例容器才显示 fit 切换；auto 时隐藏
    await expect(page.getByRole("radio", { name: "完整显示" })).toBeVisible();
    await page.getByRole("radio", { name: "原始比例" }).click();
    await page.waitForTimeout(250);
    await expect(page.getByRole("radio", { name: "完整显示" })).toHaveCount(0);
    // 说明文字（alt）持久化到渲染
    await page.getByLabel("图片说明").fill("示意图甲");
    await expect(image.locator("img")).toHaveAttribute("alt", "示意图甲");
    // 替换图片：块位置不变
    const posBefore = await image.boundingBox();
    await page.getByRole("button", { name: "替换图片…" }).click();
    await page.getByLabel("选择替换图片").setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_BASE64, "base64"),
    });
    await expect(page.locator("[data-block-type='image']")).toHaveCount(1);
    const posAfter = await image.boundingBox();
    expect(Math.abs(posAfter!.x - posBefore!.x)).toBeLessThan(2);
    expect(Math.abs(posAfter!.y - posBefore!.y)).toBeLessThan(2);
  });
});
