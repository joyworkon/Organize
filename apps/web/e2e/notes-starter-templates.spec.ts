import { expect, test, type Page } from "@playwright/test";

/**
 * 空白页「快速开始」起步模板：
 * 新建空笔记 → 面板出现 → 选模板一次性插入（单步可撤销、标题顺带填入）→
 * 打字/删空面板隐现 → Esc 本次会话关闭 → 只读查看者看不到。
 */

function todayLabel(): string {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日`;
}

async function createFreshNote(page: Page) {
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
  await expect(page).not.toHaveURL(/note-1$/);
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 15_000 });
  return editor;
}

const panel = (page: Page) => page.getByRole("group", { name: "快速开始" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
});

test("starter panel: appears on empty note, template applies in one undoable step, Esc dismisses for session", async ({ page }) => {
  const editor = await createFreshNote(page);

  // 空正文 → 面板出现（6 个选项：5 模板 + 空白页）
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("button")).toHaveCount(6);

  // 一开始打字，面板立即消失
  await editor.locator("p").first().click();
  await page.keyboard.insertText("随手记一笔");
  await expect(panel(page)).toHaveCount(0);

  // 全部删除（正文重新变空）→ 面板再次出现
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(panel(page)).toBeVisible();

  // 选「会议纪要」：结构一次性插入、面板消失、空标题顺带填入默认标题（含今天日期）
  await panel(page).getByRole("button", { name: /会议纪要/ }).click();
  await expect(editor).toContainText("会议信息");
  await expect(editor).toContainText("结论与行动项");
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator("textarea.note-title")).toHaveValue(`会议纪要 ${todayLabel()}`);

  // Cmd/Ctrl+Z 一步撤回回到空页 → 面板重现（标题保留已填内容，不覆盖）
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("会议信息");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator("textarea.note-title")).toHaveValue(`会议纪要 ${todayLabel()}`);

  // 键盘可达：Tab/方向键移动、Esc 关闭，本次打开会话不再显示
  const meetingButton = panel(page).getByRole("button", { name: /会议纪要/ });
  await meetingButton.focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel(page).getByRole("button", { name: /周报/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  // 会话级关闭：面板不因焦点变化重新出现
  await editor.locator("p").first().click();
  await expect(panel(page)).toHaveCount(0);
});

test("starter panel: todo template counts as content (panel hides, note kept)", async ({ page }) => {
  const editor = await createFreshNote(page);
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("button", { name: /待办清单/ }).click();
  await expect(editor.locator("ul[data-type='taskList'] li")).toHaveCount(5);
  // 即使待办项文本为空，选了模板也视为有内容：面板消失
  await expect(panel(page)).toHaveCount(0);
  // 空标题 → 填入模板默认标题
  await expect(page.locator("textarea.note-title")).toHaveValue("待办清单");

  // 撤销一步回到空页 → 面板重现
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor.locator("ul[data-type='taskList']")).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
});

test("starter panel: blank option dismisses and focuses the editor", async ({ page }) => {
  const editor = await createFreshNote(page);
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole("button", { name: /空白页/ }).click();
  await expect(panel(page)).toHaveCount(0);
  // 直接书写：焦点已在正文
  await page.keyboard.insertText("直接写的内容");
  await expect(editor).toContainText("直接写的内容");
});

test("starter panel: viewer does not see it", async ({ page }) => {
  await page.goto("/notes/note-shared-viewer");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toBeVisible();
  // 只读：编辑器不可编辑，快速开始面板不出现
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(panel(page)).toHaveCount(0);
});
