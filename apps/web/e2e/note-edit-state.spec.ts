import { expect, test, type Page } from "@playwright/test";

const queueKey = "organize:offline:note-creates:v1";
const noteId = "e2e-offline-draft";
const userId = "mock-user-0001";
const draftKey = `organize:note-draft:${userId}:${noteId}`;
const blockId = "e2e-stable-paragraph";
const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", attrs: { id: blockId }, content: [{ type: "text", text }] }],
});

// Only navigator's connectivity signal is simulated: mockDb still exercises the real
// client/save-session path. The once marker prevents reload from recreating a draft.
async function seedOffline(page: Page, owner = userId, withDraft = true) {
  await page.addInitScript(({ queueKey, draftKey, noteId, owner, withDraft, initial, latest }) => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("e2e-note-online") === "true",
    });
    if (localStorage.getItem("e2e-note-seeded")) return;
    localStorage.setItem("e2e-note-seeded", "1");
    localStorage.setItem(queueKey, JSON.stringify([{
      op_id: "e2e-create", created_at: Date.now(),
      note: { id: noteId, user_id: owner, title: "离线初始标题", content: initial },
    }]));
    if (withDraft) localStorage.setItem(draftKey, JSON.stringify({
      version: 1, noteId, userId: owner, baseRevision: 0,
      updatedAt: new Date().toISOString(),
      draft: {
        title: "恢复后的标题", content: latest, icon: null, cover_url: null,
        cover_position: 50, parent_note_id: null, full_width: false,
        font_family: "default", small_font: false, page_template: "default",
      },
    }));
  }, { queueKey, draftKey, noteId, owner, withDraft,
    initial: body("离线创建原文"), latest: body("后来编辑的完整正文") });
}

async function setOnline(page: Page, online: boolean) {
  await page.evaluate((value) => {
    sessionStorage.setItem("e2e-note-online", String(value));
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  }, online);
}

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1
  )).toBe(true);
}

test("offline create survives reload, recovers the newer draft and saves on reconnect", async ({ page }) => {
  await seedOffline(page);
  await page.goto(`/notes/${noteId}`);
  await expect(page.getByRole("dialog")).toContainText("发现未保存的本地草稿");
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("恢复后的标题");
  await page.getByRole("button", { name: "恢复本地草稿", exact: true }).click();

  const editor = page.locator(".tiptap.organize-editor");
  const status = page.locator(".note-save-status");
  await expect(page.locator("textarea.note-title")).toHaveValue("恢复后的标题");
  await expect(editor).toContainText("后来编辑的完整正文");
  await expect(editor.locator(`[data-id="${blockId}"]`)).toContainText("后来编辑的完整正文");
  await expect(status).toContainText("尚未同步");
  await expect(status).not.toContainText("已保存");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").length, queueKey)).toBe(1);

  await setOnline(page, true);
  await expect(status).toContainText("已保存");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").length, queueKey)).toBe(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), draftKey)).toBeNull();
  // SPA navigation retains mockDb; a full reload intentionally resets that in-memory backend.
  await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
  await expect(page).not.toHaveURL(new RegExp(`${noteId}$`));
  await page.goBack();
  await expect(page.locator("textarea.note-title")).toHaveValue("恢复后的标题");
  await expect(editor.locator(`[data-id="${blockId}"]`)).toContainText("后来编辑的完整正文");
});

test("another account's pending create is neither shown nor removed", async ({ page }) => {
  await seedOffline(page, "another-user", false);
  await page.goto(`/notes/${noteId}`);
  await expect(page.getByText("当前无网络连接，联网后将自动恢复阅读与编辑")).toBeVisible();
  await expect(page.locator(".tiptap.organize-editor")).toHaveCount(0);
  await expect(page.getByText("离线创建原文", { exact: true })).toHaveCount(0);
  await setOnline(page, true);
  await expect.poll(() => page.evaluate((key) => {
    const queue = JSON.parse(localStorage.getItem(key) || "[]");
    return queue.map((op: { note: { user_id: string } }) => op.note.user_id);
  }, queueKey)).toEqual(["another-user"]);
});

for (const width of [320, 390, 1440]) {
  test(`offline edits show pending status and fit the ${width}px viewport`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await seedOffline(page, userId, false);
    await page.goto("/notes/note-1");
    const title = page.locator("textarea.note-title");
    const editor = page.locator(".tiptap.organize-editor");
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await title.fill("窄屏离线编辑标题与待同步状态");
    const status = page.locator(".note-save-status");
    await expect(status).toContainText("尚未同步");
    await expect(status).not.toContainText("已保存");
    await expectNoPageOverflow(page);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
      await expectNoPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`note-${width}-${theme}.png`) });
    }
  });
}

test("IME confirmation keeps the title intact and preserves the mounted editor and block IDs", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await page.goto("/notes/note-1");
  const editor = page.locator(".tiptap.organize-editor");
  const title = page.locator("textarea.note-title");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect.poll(() => editor.locator("[data-id]").count()).toBeGreaterThan(0);

  // A test-only reference to the actual DOM node catches silent useEditor rebuilds.
  const before = await editor.evaluate((element) => {
    (window as Window & { __e2eOriginalEditor?: Element }).__e2eOriginalEditor = element;
    return {
      text: element.textContent,
      ids: Array.from(element.querySelectorAll("[data-id]"), (block) => block.getAttribute("data-id")),
    };
  });
  await title.dispatchEvent("compositionstart", { data: "中文" });
  await title.fill("中文输入法完整候选标题");
  // Put the caret inside the title so an accidental title-to-body split is observable.
  await title.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(4, 4);
    element.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 229, which: 229,
      isComposing: true, bubbles: true, cancelable: true,
    }));
  });
  await expect(title).toHaveValue("中文输入法完整候选标题");
  await expect(title).toBeFocused();
  expect(await editor.textContent()).toBe(before.text);
  await title.dispatchEvent("compositionend", { data: "中文输入法完整候选标题" });
  await expect(page.locator(".note-save-status")).toContainText("已保存");
  await expect(title).toHaveValue("中文输入法完整候选标题");
  const after = await editor.evaluate((element) => ({
    sameNode: (window as Window & { __e2eOriginalEditor?: Element }).__e2eOriginalEditor === element,
    text: element.textContent,
    ids: Array.from(element.querySelectorAll("[data-id]"), (block) => block.getAttribute("data-id")),
  }));
  expect(after.sameNode).toBe(true);
  expect(after.text).toBe(before.text);
  expect(after.ids).toEqual(before.ids);
});
