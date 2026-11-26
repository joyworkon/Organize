import { expect, test, type Page } from "@playwright/test";

/** 离线创建队列按账号隔离存储 key：前缀 + user_id（见 lib/offline/note-queue.ts） */
const QUEUE_KEY_PREFIX = "organize:offline:note-creates:v1:";
/** 旧版本（不分账号）的全局 key：存量在各属主首次读取时迁移走 */
const LEGACY_QUEUE_KEY = "organize:offline:note-creates:v1";
const queueKeyFor = (owner: string) => `${QUEUE_KEY_PREFIX}${owner}`;
const noteId = "e2e-offline-draft";
const userId = "mock-user-0001";
const otherUserId = "another-user";
const draftKey = `organize:note-draft:${userId}:${noteId}`;
const blockId = "e2e-stable-paragraph";
const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", attrs: { id: blockId }, content: [{ type: "text", text }] }],
});

const createOp = (id: string, owner: string, title: string) => ({
  op_id: `op-${id}`, created_at: Date.now(),
  note: { id, user_id: owner, title, content: body("离线创建原文") },
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
  }, { queueKey: queueKeyFor(owner), draftKey, noteId, owner, withDraft,
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

/** 三个队列里各躺着谁的离线创建（按 user_id 列出） */
const readQueues = (page: Page) => page.evaluate(({ own, other, legacy }) => {
  const owners = (key: string) => (JSON.parse(localStorage.getItem(key) || "[]") as {
    note: { user_id: string };
  }[]).map((op) => op.note.user_id);
  return { own: owners(own), other: owners(other), legacy: owners(legacy) };
}, { own: queueKeyFor(userId), other: queueKeyFor(otherUserId), legacy: LEGACY_QUEUE_KEY });

test("offline create survives reload, recovers the newer draft and saves on reconnect", async ({ page }) => {
  const ownQueueKey = queueKeyFor(userId);
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
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").length, ownQueueKey)).toBe(1);

  await setOnline(page, true);
  await expect(status).toContainText("已保存");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").length, ownQueueKey)).toBe(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), draftKey)).toBeNull();
  // SPA navigation retains mockDb; a full reload intentionally resets that in-memory backend.
  await page.getByRole("button", { name: "新建笔记并打开标签页" }).click();
  await expect(page).not.toHaveURL(new RegExp(`${noteId}$`));
  await page.goBack();
  await expect(page.locator("textarea.note-title")).toHaveValue("恢复后的标题");
  await expect(editor.locator(`[data-id="${blockId}"]`)).toContainText("后来编辑的完整正文");
});

test("another account's pending create is neither shown nor removed", async ({ page }) => {
  await seedOffline(page, otherUserId, false);
  await page.goto(`/notes/${noteId}`);
  await expect(page.getByText("当前无网络连接，联网后将自动恢复阅读与编辑")).toBeVisible();
  await expect(page.locator(".tiptap.organize-editor")).toHaveCount(0);
  await expect(page.getByText("离线创建原文", { exact: true })).toHaveCount(0);
  await setOnline(page, true);
  await expect.poll(() => readQueues(page)).toEqual({ own: [], other: [otherUserId], legacy: [] });
});

test("the notes list neither shows nor replays another account's pending creates", async ({ page }) => {
  // 同一台浏览器换号后：上一位的离线笔记还在——一条在他自己的队列里，一条是旧版本
  // 留在全局 key 里的残留；本人自己也有一条待同步的。当前账号的列表页不能显示别人的，
  // 更不能拿去回放：以新账号的会话插入会被 RLS 拒绝，按「服务端拒绝」丢弃就等于替上一位删了笔记。
  await page.addInitScript(({ own, other, legacy, opOwn, opA, opB }) => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("e2e-note-online") === "true",
    });
    localStorage.setItem(own, JSON.stringify([opOwn]));
    localStorage.setItem(other, JSON.stringify([opA]));
    localStorage.setItem(legacy, JSON.stringify([opB]));
  }, {
    own: queueKeyFor(userId),
    other: queueKeyFor(otherUserId),
    legacy: LEGACY_QUEUE_KEY,
    opOwn: createOp("e2e-own-note", userId, "本人的离线笔记应正常显示"),
    opA: createOp("e2e-other-account-note", otherUserId, "别人的离线笔记不应出现"),
    opB: createOp("e2e-legacy-other-note", otherUserId, "旧版残留的别人笔记也不应出现"),
  });

  // 离线时不回放，待同步的条目直接合进列表：只有本人那一篇该出现，待同步计数也只算本人那一篇
  await page.goto("/notes");
  // 等列表渲染出来再否定：否则「没出现」可能只是因为还没渲染
  await expect(page.locator("h3").first()).toBeVisible();
  await expect(page.getByText("别人的离线笔记不应出现")).toHaveCount(0);
  await expect(page.getByText("旧版残留的别人笔记也不应出现")).toHaveCount(0);
  await expect(page.getByText("本人的离线笔记应正常显示")).toBeVisible();
  await expect(page.getByText(/离线中 · 1 篇待同步/)).toBeVisible();
  // 旧 key 里别人的那条不会被当前账号接手
  await expect.poll(() => readQueues(page)).toEqual({
    own: [userId], other: [otherUserId], legacy: [otherUserId],
  });

  // 联网后按本人的队列回放：本人那一篇出队，说明回放确实跑过了；别人的两条必须原样留着
  await setOnline(page, true);
  await expect(page.getByText(/离线中/)).toHaveCount(0);
  await expect.poll(() => readQueues(page)).toEqual({
    own: [], other: [otherUserId], legacy: [otherUserId],
  });
  await expect(page.getByText("别人的离线笔记不应出现")).toHaveCount(0);
  await expect(page.getByText("旧版残留的别人笔记也不应出现")).toHaveCount(0);
});

test("a pending create left in the legacy global key still works for its owner", async ({ page }) => {
  // 升级前留在旧版全局 key 里的离线创建：属主打开列表时迁到自己名下，照常显示、照常同步
  await page.addInitScript(({ legacy, op }) => {
    localStorage.setItem("organize:onboarded", "1");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("e2e-note-online") === "true",
    });
    localStorage.setItem(legacy, JSON.stringify([op]));
  }, { legacy: LEGACY_QUEUE_KEY, op: createOp("e2e-legacy-own-note", userId, "升级前离线创建的笔记") });

  await page.goto("/notes");
  await expect(page.getByText("升级前离线创建的笔记")).toBeVisible();
  // 已迁到本人名下的 key，旧 key 清空
  await expect.poll(() => readQueues(page)).toEqual({ own: [userId], other: [], legacy: [] });

  // 联网后按本人的会话回放：入队条目出队
  await setOnline(page, true);
  await expect.poll(() => readQueues(page)).toEqual({ own: [], other: [], legacy: [] });
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
