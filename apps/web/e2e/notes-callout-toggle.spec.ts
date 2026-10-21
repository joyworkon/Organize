import { expect, test } from "@playwright/test";

/**
 * 笔记标注块（Callout）与折叠块（Toggle/Details）体验升级（2026-10-21）：
 * - Callout 图标选择器：Popover 化，键盘全程可操作（搜索/方向键/Enter/Esc 还焦点），
 *   触屏点按可用，可移除图标，语义色调即时生效并落到 data-tone；
 * - 折叠块：summary 内 Mod+Enter 切换展开/收起，三角按钮 aria-expanded，
 *   收起时 summary 末尾回车在块后新建同级段落，空 summary 退格解包不吞内容。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
});

async function createNote(page: import("@playwright/test").Page) {
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
  await expect(page).not.toHaveURL(/note-1$/);
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 15_000 });
  await editor.locator("p").first().click();
  return { editor };
}

async function focusSummary(details: import("@playwright/test").Locator) {
  const summary = details.locator("summary");
  await summary.click({ position: { x: 2, y: 8 } });
  // Chromium 的 selectionchange 异步到达；快捷键须等真实编辑器选区进入 summary。
  await expect.poll(() => summary.evaluate((element) => {
    const root = element.closest(".tiptap") as HTMLElement & { editor: import("@tiptap/core").Editor };
    return root.editor.state.selection.$anchor.parent.type.name;
  })).toBe("detailsSummary");
}

test("标注块：图标选择器键盘可达、可搜索、可换色调、可移除图标", async ({ page }) => {
  const { editor } = await createNote(page);

  // 斜杠菜单插入「标注」
  await page.keyboard.type("/");
  const menu = page.locator(".block-command-popover");
  await expect(menu).toBeVisible();
  await page.keyboard.insertText("标注");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  const callout = editor.locator("[data-callout]");
  await expect(callout).toHaveCount(1);
  await expect(callout).toHaveAttribute("data-emoji", "💡");

  const trigger = callout.locator(".callout-emoji");
  const popover = page.locator(".callout-icon-popover");
  const grid = popover.locator(".callout-icon-grid button");

  // 打开选择器：搜索框自动聚焦；中文关键词过滤
  await trigger.focus();
  await page.keyboard.press("Space");
  await expect(popover).toBeVisible();
  await expect(popover.getByLabel("搜索标注图标")).toBeFocused();
  await expect(grid).toHaveCount(24);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(grid.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(grid.nth(7)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  await expect(grid.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(popover.getByLabel("搜索标注图标")).toBeFocused();
  await page.keyboard.insertText("警告");
  await expect(grid).toHaveCount(1);
  await expect(grid.first()).toHaveText("⚠️");

  // ArrowDown 进入网格，Enter 选中，弹层关闭、图标更新
  await page.keyboard.press("ArrowDown");
  await expect(grid.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popover).toHaveCount(0);
  await expect(callout).toHaveAttribute("data-emoji", "⚠️");

  // Esc 关闭并把焦点还给图标按钮；点外关闭
  await trigger.click();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(popover).toBeVisible();
  const editorBox = (await editor.boundingBox())!;
  await page.mouse.click(editorBox.x + 40, editorBox.y + editorBox.height - 6);
  await expect(popover).toHaveCount(0);

  // 语义色调：点击即时生效（弹层保持打开），data-tone 落在块上
  await trigger.click();
  await expect(popover.getByLabel("搜索标注图标")).toBeFocused();
  await page.keyboard.press("Tab"); // 网格唯一 tab stop
  await page.keyboard.press("Tab"); // 默认色调
  await page.keyboard.press("Tab"); // 信息
  await page.keyboard.press("Tab"); // 成功
  await page.keyboard.press("Tab"); // 警告
  await expect(popover.getByRole("button", { name: "警告", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(callout).toHaveAttribute("data-tone", "warning");
  await popover.locator(".callout-tone-row button[data-tone='success']").click();
  await expect(callout).toHaveAttribute("data-tone", "success");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);

  // 移除图标：无图标态保留可再打开选择器补回（英文关键词）
  await trigger.click();
  await popover.getByRole("button", { name: "移除图标" }).click();
  await expect(callout).toHaveAttribute("data-emoji", "");
  await expect(trigger).toContainText("＋");
  await trigger.click();
  await expect(popover.getByLabel("搜索标注图标")).toBeFocused();
  await page.keyboard.type("done");
  await expect(grid).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(callout).toHaveAttribute("data-emoji", "✅");

  // 390px 手机宽度：弹层完整可见、不超屏
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(popover).toBeVisible();
  const box = await popover.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(382);
  await page.keyboard.press("Escape");
});

test.describe("触屏标注", () => {
  test.use({ hasTouch: true });

  test("390px 触屏点按、深浅色与弹层边界", async ({ page }, testInfo) => {
    // 弹层入场 zoom-in-95（150ms）会让 boundingBox 测得 43.x px：关动画后触控目标断言才稳定。
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { editor } = await createNote(page);
    await page.keyboard.type("/");
    await expect(page.locator(".block-command-popover")).toBeVisible();
    await page.keyboard.insertText("标注");
    await page.keyboard.press("Enter");
    const callout = editor.locator("[data-callout]");
    await expect(callout).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const trigger = callout.locator(".callout-emoji");
    await trigger.tap();
    const popover = page.locator(".callout-icon-popover");
    await expect(popover).toBeVisible();
    await popover.getByRole("button", { name: "🔥", exact: true }).tap();
    await expect(callout).toHaveAttribute("data-emoji", "🔥");
    await trigger.tap();
    await popover.getByRole("button", { name: "危险", exact: true }).tap();
    await expect(callout).toHaveAttribute("data-tone", "danger");
    for (const dark of [false, true]) {
      await page.evaluate((dark) => {
        localStorage.setItem("organize-theme", dark ? "dark" : "light");
        window.dispatchEvent(new CustomEvent("organize:theme-mode-change"));
      }, dark);
      await expect(page.locator("html")).toHaveClass(dark ? /dark/ : /^(?!.*dark)/);
      await expect(popover).toHaveCSS("background-color", dark ? "rgb(33, 33, 33)" : "rgb(255, 255, 255)");
      await expect(popover).toHaveCSS("color", dark ? "rgb(238, 238, 238)" : "rgb(32, 32, 32)");
      const box = (await popover.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      const icon = (await popover.locator(".callout-icon-grid button").first().boundingBox())!;
      expect(icon.width).toBeGreaterThanOrEqual(44);
      expect(icon.height).toBeGreaterThanOrEqual(44);
      await expect(popover.getByLabel("搜索标注图标")).toHaveCSS("font-size", "16px");
      await page.screenshot({ path: testInfo.outputPath(`callout-390-${dark ? "dark" : "light"}.png`) });
    }
    await popover.getByRole("button", { name: "默认", exact: true }).tap();
    await expect(callout).not.toHaveAttribute("data-tone");
  });
});

test("块菜单：转换为标注保留正文和块 ID，颜色菜单可切换标注色调", async ({ page }) => {
  const { editor } = await createNote(page);
  await page.keyboard.insertText("转换后保留的正文");
  const paragraph = editor.locator("> p").first();
  const id = await paragraph.getAttribute("data-id");
  await paragraph.hover();
  await page.getByRole("button", { name: "拖动区块或打开菜单" }).click();
  await page.locator(".block-action-popover").getByRole("button", { name: "转换成", exact: true }).click();
  await page.locator(".block-action-flyout").getByRole("button", { name: "标注", exact: true }).click();
  const callout = editor.locator("[data-callout]");
  await expect(callout).toContainText("转换后保留的正文");
  expect(await editor.evaluate((element) => {
    const root = element as HTMLElement & { editor: import("@tiptap/core").Editor };
    return root.editor.state.doc.firstChild?.attrs.id;
  })).toBe(id);
  await callout.locator("p").hover();
  await page.getByRole("button", { name: "拖动区块或打开菜单" }).click();
  await page.locator(".block-action-popover").getByRole("button", { name: "颜色", exact: true }).click();
  await page.locator(".block-action-flyout").getByRole("button", { name: "信息", exact: true }).click();
  await expect(callout).toHaveAttribute("data-tone", "info");
  await expect(callout).toContainText("转换后保留的正文");
});

test("折叠块：Mod+Enter 切换、三角 aria、收起回车与空 summary 退格", async ({ page }) => {
  const { editor } = await createNote(page);

  // 斜杠菜单插入「折叠列表」
  await page.keyboard.type("/");
  const menu = page.locator(".block-command-popover");
  await expect(menu).toBeVisible();
  await page.keyboard.insertText("折叠列表");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  const details = editor.locator("div[data-type='details']");
  await expect(details).toHaveCount(1);
  const toggle = details.locator("> button");
  // 默认展开；初始 class 延后一拍，断言自动重试
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-label", "展开或折叠");

  await focusSummary(details);
  await page.keyboard.insertText("标题甲");
  await expect(details.locator("summary")).toHaveText("标题甲");
  // summary 内 Mod+Enter 收起：内容隐藏、aria 跟随；再按展开
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(details.locator("div[data-type='detailsContent']")).toBeHidden();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(details.locator("div[data-type='detailsContent']")).toBeVisible();

  // 写入折叠内容后收起，summary 末尾回车 → 在折叠块后新建同级段落（不钻进隐藏内容）
  await details.locator("div[data-type='detailsContent'] p").click();
  await page.keyboard.insertText("折叠内容");
  await focusSummary(details);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(details.locator("div[data-type='detailsContent']")).toBeHidden();
  await focusSummary(details);
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.press("Enter");
  const after = editor.locator("div[data-type='details'] + p");
  await expect(after).toHaveCount(1);
  await page.keyboard.insertText("块外段落");
  await expect(after).toHaveText("块外段落");
  await expect(details.locator("div[data-type='detailsContent']")).toContainText("折叠内容");

  // 编辑器内 Tab 进入三角按钮，Enter 使用原生按钮行为切换
  await editor.focus();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // 空 summary Backspace 解包：内容转普通段落，折叠块消失、内容不丢
  await after.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.keyboard.insertText("折叠列表");
  await page.keyboard.press("Enter");
  await expect(details).toHaveCount(2);
  await details.nth(1).locator("[data-type='detailsContent'] p").click();
  await page.keyboard.insertText("退格后保留的正文");
  await focusSummary(details.nth(1));
  await page.keyboard.press("Backspace"); // 空 summary 内退格
  await expect(details).toHaveCount(1);
  await expect(editor.locator("> p", { hasText: "退格后保留的正文" })).toHaveCount(1);
  await expect(editor.locator("> p", { hasText: "块外段落" })).toHaveCount(1);
});
