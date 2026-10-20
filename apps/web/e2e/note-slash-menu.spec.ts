import { expect, test } from "@playwright/test";

/**
 * 斜杠菜单「行内输入即筛选」：打 "/" 后焦点留在正文，继续输入的字符就是查询词；
 * Enter 执行并清掉 "/查询词"（块里原有文字保留）；Esc 保留文本；无匹配多打两字自动收起；
 * 用过的区块出现在「最近使用」；⌘/ 唤出的菜单仍带搜索框并聚焦。
 */
test("slash menu filters inline, keeps focus in the editor and remembers recent blocks", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
  await expect(page).not.toHaveURL(/note-1$/);
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 15_000 });
  await editor.locator("p").first().click();

  const popover = page.locator(".block-command-popover");
  const listbox = popover.getByRole("listbox", { name: "区块命令" });
  const hint = popover.getByRole("status");
  const focusInEditor = () => page.evaluate(() => Boolean(document.activeElement?.closest(".tiptap.organize-editor")));

  // "/" 唤出：没有搜索框，焦点仍在正文；正文里继续打 h2 即筛选
  await page.keyboard.type("/");
  await expect(listbox).toBeVisible();
  await expect(popover.getByLabel("筛选区块")).toHaveCount(0);
  expect(await focusInEditor()).toBe(true);
  await expect(hint).toContainText("输入以筛选");
  await page.keyboard.type("h2");
  await expect(hint).toHaveText("正在筛选：h2");
  await expect(popover.getByRole("option", { name: /^标题 2/ })).toBeVisible();
  await expect(popover.getByRole("option", { name: /^标题 1/ })).toHaveCount(0);
  await expect(popover.getByRole("option", { name: /^标题 2/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(popover).toHaveCount(0);
  await expect(editor.locator("h2")).toHaveCount(1);
  await expect(editor).not.toContainText("/h2");
  expect(await focusInEditor()).toBe(true);

  // 已有文字的块开头打 "/待办" 回车：变成待办，原文字保留，"/待办" 不残留；命中片段高亮、快捷写法提示
  await page.keyboard.insertText("章节标题");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("已有文字");
  await page.keyboard.press("Home");
  await page.keyboard.type("/");
  await expect(listbox).toBeVisible();
  await page.keyboard.insertText("待办");
  await expect(hint).toHaveText("正在筛选：待办");
  const todo = popover.getByRole("option", { name: /^待办列表/ });
  await expect(todo.locator("mark")).toHaveText("待办");
  await expect(todo.locator("kbd")).toHaveText("[]");
  await page.keyboard.press("Enter");
  await expect(popover).toHaveCount(0);
  await expect(editor.locator("ul[data-type='taskList'] li")).toHaveCount(1);
  await expect(editor.locator("ul[data-type='taskList'] li")).toContainText("已有文字");
  await expect(editor).not.toContainText("/待办");

  // Esc 关闭：已打的 "/xx" 保留在正文里，光标不动
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(editor.locator("> p").last()).toHaveText("");
  await page.keyboard.type("/xx");
  await expect(listbox).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(editor.locator("> p").last()).toHaveText("/xx");
  expect(await focusInEditor()).toBe(true);
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("Backspace");

  // 无匹配后再多打两个字符自动收起，文本原样留下
  await page.keyboard.type("/zz");
  await expect(listbox).toBeVisible();
  await expect(popover.locator(".editor-menu-empty")).toHaveText("没有匹配的区块");
  await page.keyboard.type("zz");
  await expect(popover).toHaveCount(0);
  await expect(editor.locator("> p").last()).toHaveText("/zzzz");
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Backspace");

  // 再打 "/"：最上方出现「最近使用」，含刚用过的待办列表与标题 2
  await page.keyboard.type("/");
  await expect(listbox).toBeVisible();
  await expect(popover.locator(".editor-menu-label").first()).toHaveText("最近使用");
  const recentGroup = popover.locator(".editor-menu-group").first();
  await expect(recentGroup.getByRole("option", { name: /^待办列表/ })).toBeVisible();
  await expect(recentGroup.getByRole("option", { name: /^标题 2/ })).toBeVisible();
  await expect(recentGroup.getByRole("option", { name: /^待办列表/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await page.keyboard.press("Backspace");

  // ⌘/ 唤出的菜单与之前一致：有搜索框并聚焦
  await page.keyboard.press("ControlOrMeta+/");
  await expect(listbox).toBeVisible();
  await expect(popover.getByLabel("筛选区块")).toBeFocused();
  await expect(hint).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
});
