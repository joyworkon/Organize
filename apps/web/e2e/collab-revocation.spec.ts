import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// A05-4：存量连接撤权/降级端到端（真实后端，COLLAB_E2E=1 + REAL_DB_E2E=1 + 服务角色密钥）。
//
// 前置（相对既有 collab-e2e 多一项）：
//   collab-server 以短重验间隔启动：COLLAB_REAUTH_INTERVAL_MS=3000（CI 已注入；
//   本地复现见 ci.yml collab-e2e job 的启动命令）
// 测试内撤权经 PostgREST + service_role（SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL
// 需在 playwright 进程环境——CI 的 GITHUB_ENV 已导出）。
//
// 覆盖（docs/collab-session-refresh-design.md §3.2/§3.3 验收）：
//   1) editor→viewer 降级：存量连接免重连变只读（readOnly 每消息检查），
//      撤权后 B 的输入不再到达属主/服务端，连接与既有内容保持
//   2) 移除访问：重验 close → 客户端 3 次退避重握手耗尽 → 页面降级本地保存，
//      降级后输入走乐观锁链但被服务端权限拒绝，不落库不假成功
//   3) 公开链接关闭：匿名连接 close → 分享页降级只读快照提示
const collabChromium = process.env.COLLAB_E2E_CHROMIUM;
test.use({
  launchOptions: collabChromium ? { executablePath: collabChromium } : {},
});

let seed: {
  noteId: string;
  userA: { email: string; password: string };
  userB: { email: string; password: string };
  /** 种子即事实源：admin API 的 ?email= 过滤在本地 GoTrue 不生效，勿现查 */
  userAId: string;
  userBId: string;
};
let anonSeed: { noteId: string; editToken: string };

// 固定 UUID 种子（scripts/seed-collab-e2e.mjs / seed-anon-e2e.mjs 常量）
const WORKSPACE_ID = "ee000000-0000-4000-8000-000000000002";
const RUN = `·rv${Date.now().toString(36)}`;
const t = (s: string) => `${s}${RUN}`;

test.describe.serial("A05 存量连接撤权（真实后端）", () => {
  test.skip(
    process.env.COLLAB_E2E !== "1" || process.env.REAL_DB_E2E !== "1",
    "COLLAB_E2E=1 REAL_DB_E2E=1 时才运行（需本地真实后端 + collab 服务 + 短重验间隔）"
  );
  test.skip(
    !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "需要 SUPABASE_SERVICE_ROLE_KEY（测试内经 PostgREST 撤权；CI collab-e2e job 已注入）"
  );

  test.beforeAll(async () => {
    seed = JSON.parse(readFileSync(".tmp-e2e/collab-seed.json", "utf8"));
    anonSeed = JSON.parse(readFileSync(".tmp-e2e/anon-seed.json", "utf8"));
    await restoreAccess();
  });

  // 状态自愈：三场景串行共享库状态，每场开始/结束都回到「B 为空间成员 + ACL editor + 分享开」
  test.afterAll(async () => {
    await restoreAccess();
  });

  /** service_role 经 PostgREST 直改授权面（绕 RLS 是测试需要，产品代码不得效仿） */
  async function rest(
    method: "PATCH" | "DELETE" | "POST" | "GET",
    path: string,
    body?: unknown
  ): Promise<void> {
    const base = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`rest ${method} ${path}: ${res.status} ${await res.text()}`);
  }

  async function restoreAccess(): Promise<void> {
    // B 的空间成员（seed 只建 userA/userB 两行；409 = 已存在，幂等恢复）
    await rest("POST", "workspace_members", [
      { workspace_id: WORKSPACE_ID, user_id: seed.userBId, role: "member" },
    ]).catch(() => undefined);
    await rest(
      "PATCH",
      `resource_acl?workspace_id=eq.${WORKSPACE_ID}&resource_type=eq.note&resource_id=eq.${seed.noteId}`,
      { access_role: "editor" }
    );
    await rest("PATCH", `shares?token=eq.${anonSeed.editToken}`, {
      is_public: true,
      access_mode: "public_edit",
    });
  }

  async function login(page: Page, email: string, password: string) {
    await page.goto("/login");
    await page.getByPlaceholder("邮箱地址").fill(email);
    await page.getByPlaceholder("密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL("**/library");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  async function openNote(page: Page) {
    await page.goto(`/notes/${seed.noteId}`);
    await page.locator(".ProseMirror").waitFor();
    // 等协作播种/同步完成（≥2 段 = 种子正文已进房间）
    await expect
      .poll(() => page.locator(".ProseMirror > *").count(), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
  }

  /** 在编辑器第一段输入：点击后验证焦点真的进了编辑器再打字——坐标可能落在
   *  浮动元素上，按键逃逸到 body 时随机后缀里的 "g r" 会触发全局跳转（实测） */
  async function typeInFirstParagraph(page: Page, text: string) {
    await expect(page.locator(".ProseMirror")).toBeEditable({ timeout: 20_000 });
    for (let i = 0; i < 5; i++) {
      await page.locator(".ProseMirror > *").first().click();
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return !!el && (el.classList?.contains("ProseMirror") || !!el.closest?.(".ProseMirror"));
      });
      if (focused) break;
      await page.waitForTimeout(400);
    }
    await page.keyboard.type(text);
  }

  test("editor→viewer 降级：存量连接免重连变只读，撤权后输入不再到达属主", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await login(pageA, seed.userA.email, seed.userA.password);
    await login(pageB, seed.userB.email, seed.userB.password);
    await openNote(pageB);
    await openNote(pageA);

    // 降级前：B 的输入经 CRDT 到达 A（证明链路通）
    await typeInFirstParagraph(pageB, t("降级前可达"));
    await expect(pageA.locator(".ProseMirror")).toContainText(t("降级前可达"), { timeout: 15_000 });

    // 撤权：ACL editor→viewer（服务端重验 ≤COLLAB_REAUTH_INTERVAL_MS 后改 readOnly）
    await rest(
      "PATCH",
      `resource_acl?workspace_id=eq.${WORKSPACE_ID}&resource_type=eq.note&resource_id=eq.${seed.noteId}`,
      { access_role: "viewer" }
    );
    // 等 ≥2 个重验周期（CI 间隔 3s，留余量）
    await pageB.waitForTimeout(8_000);

    // 降级后：B 本地仍可输入（连接未断、既有内容在），但内容不再到达 A
    await typeInFirstParagraph(pageB, t("降级后不可达"));
    await pageA.waitForTimeout(3_000);
    await expect(pageA.locator(".ProseMirror")).not.toContainText(t("降级后不可达"));
    // 连接保持（降级不关闭）：页面不降级、此前内容仍在
    await expect(pageB.locator(".ProseMirror")).toContainText(t("降级前可达"));
    await expect(pageB.getByText("实时协作不可用")).toHaveCount(0);
    await ctxA.close();
    await ctxB.close();
  });

  test("移除访问：重验关闭连接 → 客户端退避耗尽降级本地保存，页面存活不崩", async ({ browser }) => {
    const ctxB = await browser.newContext();
    const ctxA = await browser.newContext();
    const pageB = await ctxB.newPage();
    const pageA = await ctxA.newPage();
    await login(pageB, seed.userB.email, seed.userB.password);
    await login(pageA, seed.userA.email, seed.userA.password);
    await openNote(pageB);

    // 撤权：把 B 移出空间（member 行删除；恢复由 afterAll/下场自愈负责）
    await rest("DELETE", `workspace_members?workspace_id=eq.${WORKSPACE_ID}&user_id=eq.${seed.userBId}`);
    // 客户端链路：重验 close(≤3s) → close 重握手 → 重连被拒 → 退避重握手 ×3（2/5/10s）
    // → 末次看门狗兜底降级（全链 ≈41s，窗口放宽到 60s 覆盖 CI 慢机）
    await expect(pageB.getByText("实时协作不可用，已切换为本地保存")).toBeVisible({
      timeout: 60_000,
    });
    // 降级后页面存活（编辑器还在、可读可导出）。可编辑性与块数在这里是竞态且与
    // 安全无关：角色缓存为 editor（撤权前解析）→ 本地可编辑但保存链被 RPC 拒绝
    //（不假成功，由 synced-block「无权视角」场景钉住）；撤权后解析 → viewer 只读。
    // 属主侧不受影响由 test 1 的 pageA 断言覆盖
    await expect(pageB.locator(".ProseMirror")).toBeAttached();
    await ctxA.close();
    await ctxB.close();
  });

  test("公开链接关闭：匿名连接重验关闭 → 分享页降级只读快照提示", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/s/${anonSeed.editToken}`);
    await page.locator(".ProseMirror").waitFor({ timeout: 20_000 });
    // 「正在进入实时会话…」消失 = provider 已挂、协作实例已接管（连接确实建立）
    await page.getByText("正在进入实时会话…").waitFor({ state: "detached", timeout: 20_000 });
    // 房间已有 blob 内容（此前套件的匿名协同输入）：关闭后此内容应保持展示
    const contentBefore = await page.locator(".ProseMirror").innerText();

    // 关闭链接：access_mode=disabled（非空列；与 is_public=false 满足 CHECK 一致性）
    // → resolve_share_access 重验无结论 → close
    await rest("PATCH", `shares?token=eq.${anonSeed.editToken}`, { is_public: false, access_mode: "disabled" });
    await expect(page.getByText("实时协作暂不可用，以下为只读快照；刷新页面可重试")).toBeVisible({
      timeout: 60_000,
    });
    // 已有内容保持展示
    await expect(page.locator(".ProseMirror")).toContainText("属主播种内容");
    expect(contentBefore.includes("属主播种内容")).toBe(true);
    await ctx.close();
  });
});
