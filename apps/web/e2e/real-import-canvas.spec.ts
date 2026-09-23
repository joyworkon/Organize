import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * 真实后端「导入 → 恢复 → 中断回收 → 重试 → 画布联动」回归（收口阶段 5）。
 * 把原先 gitignored 的个人临时验收脚本固化成仓库内可重复运行的测试。
 *
 * 门控：REAL_DB_E2E=1 才运行（testMatch 挂在 playwright.collab.config.ts）。
 * 前置（与 collab.spec 同全栈，本 spec 不依赖 collab-server）：
 *   supabase start && supabase migration up
 *   web（真实后端）：cd apps/web && npx next start -p 3100
 *     （NEXT_PUBLIC_MOCK_BACKEND 未设 / =false，NEXT_PUBLIC_SUPABASE_URL 指向本地栈）
 * 运行：REAL_DB_E2E=1 COLLAB_E2E=1 npx playwright test -c playwright.collab.config.ts e2e/real-import-canvas.spec.ts
 *
 * 覆盖：
 *   导入链路：文件导入 saved → 打开条目 → 下载原件 200 → 整页刷新恢复列表；
 *   中断回收：service_role 把行改回 uploading + 11 分钟前 → GET 惰性回收标 failed
 *   （「导入中断」）→ 重选文件重试 → saved（身份校验 + retryKey 复用）；
 *   画布联动：新建画布真实落库（保存状态非「演示模式」）→ 刷新持久 →
 *   资料面板插入引用卡片 → 来源删除 → 「来源不可用」角标且快照保留。
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
// service_role JWT：由运行环境注入（本地 `export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)`；
// CI collab-e2e job 已注入同名变量）。仅用于把导入行改成「11 分钟前在途」制造可回收的中断态、
// 以及软删测试来源。
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const REAL =
  process.env.REAL_DB_E2E === "1" &&
  process.env.COLLAB_E2E === "1" &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const email = `real-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@real.test`;
const password = "real-import-pass-1";
const FILE_NAME = "e2e-real-import.md";
const FILE_BYTES = Buffer.from("# 真实导入标题\n\n- 中断恢复验证\n- 刷新恢复验证\n");

test.describe("真实后端导入与画布联动（收口阶段 5）", () => {
  test.skip(!REAL, "REAL_DB_E2E=1 + COLLAB_E2E=1 时才运行（需本地真实后端全栈）");

  async function login(page: Page) {
    await page.addInitScript(() => {
      window.localStorage.setItem("organize:onboarded", "1");
    });
    await page.goto("/login");
    await page.getByPlaceholder("邮箱地址").fill(email);
    await page.getByPlaceholder("密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL("**/library");
  }

  test("导入链路 + 中断回收 + 重试 + 刷新恢复", async ({ page }) => {
    const signup = createClient(URL, ANON_KEY);
    const { error } = await signup.auth.signUp({ email, password });
    expect(error).toBeNull();

    await login(page);
    await page.goto("/library?view=files");
    await page.getByLabel("选择要导入的文件").setInputFiles({
      name: FILE_NAME,
      mimeType: "text/markdown",
      buffer: FILE_BYTES,
    });
    await expect(page.getByText("已导入 1 个文件").first()).toBeVisible({ timeout: 15_000 });
    const row = page.locator("section[aria-label='文件导入'] li", { hasText: FILE_NAME });
    await expect(row.getByText("已保存")).toBeVisible();
    await expect(row.getByRole("link", { name: "打开条目" })).toBeVisible();

    // 打开条目：提取正文真实入库
    await row.getByRole("link", { name: "打开条目" }).click();
    await expect(page.getByText("真实导入标题").first()).toBeVisible({ timeout: 15_000 });

    // 下载原件：私有桶经鉴权路由返回原始字节
    const download = await page.evaluate(async (name) => {
      const list = await fetch("/api/imports?limit=50").then((r) => r.json());
      const hit = list.files.find((f: { fileName: string }) => f.fileName === name);
      if (!hit) return { status: 404 };
      const res = await fetch(`/api/imports/file?id=${encodeURIComponent(hit.id)}`);
      const text = await res.text();
      return { status: res.status, text, id: hit.id, retryKey: hit.retryKey };
    }, FILE_NAME);
    expect(download.status).toBe(200);
    expect(download.text).toContain("中断恢复验证");

    // 整页刷新：import_files 落库恢复（真实后端核心承诺）
    await page.goto("/library?view=files");
    await expect(
      page.getByText(FILE_NAME).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 中断回收：把行改回 uploading + 11 分钟前。updated_at 有 BEFORE UPDATE 触发器
    // 强制刷新（任何 UPDATE 都会把它抹成 now），必须经 SQL 短暂禁用触发器做旧——
    // 真实中断恰恰是「再也没有 UPDATE」，此测试手法不影响生产行为。
    const { execSync } = await import("node:child_process");
    const dbContainer = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_Organize";
    execSync(
      `docker exec ${dbContainer} psql -U postgres -d postgres -c "` +
        "ALTER TABLE import_files DISABLE TRIGGER update_import_files_updated_at;" +
        `UPDATE import_files SET status = 'uploading', error = NULL, updated_at = now() - interval '11 minutes' WHERE retry_key = '${download.retryKey}';` +
        "ALTER TABLE import_files ENABLE TRIGGER update_import_files_updated_at;" +
        '"',
      { stdio: "pipe" },
    );

    // 重新进入文件视图 → GET 触发服务端惰性回收 → 行变 failed「导入中断」
    await page.reload();

    // 刷新后队列已清空，失败行在「文件历史」列表（FilesView）
    await expect(page.getByText(/导入中断/).first()).toBeVisible({ timeout: 20_000 });

    // 单文件重试：重选同一文件（身份：文件名+大小一致）→ 复用 retryKey → saved
    await page
      .getByRole("button", { name: new RegExp(`重试导入 ${FILE_NAME}`) })
      .click();
    await page.getByLabel("重新选择文件以重试").setInputFiles({
      name: FILE_NAME,
      mimeType: "text/markdown",
      buffer: FILE_BYTES,
    });
    await expect(page.getByText("已保存", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    // 重试不产生第二行、不重复建资料
    const count = await page.evaluate(async (name) => {
      const list = await fetch("/api/imports?limit=50").then((r) => r.json());
      return list.files.filter((f: { fileName: string }) => f.fileName === name).length;
    }, FILE_NAME);
    expect(count).toBe(1);
  });

  test("画布联动：真实落库持久 + 引用卡片 + 来源删除角标", async ({ page }) => {
    const admin = createClient(URL, SERVICE_KEY);
    await login(page);

    // 先造一条速记（资料面板的引用来源）
    await page.goto("/library");
    await page.getByLabel("资料库统一输入").fill("真实联动速记标题\n\n用于真实后端画布引用的正文。");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/已保存/).first()).toBeVisible({ timeout: 15_000 });

    // 新建画布 → 落地页骨架 → 真实保存（非演示模式）
    await page.locator("nav").first().getByRole("link", { name: "构思画布" }).click();
    await expect(page).toHaveURL(/\/canvas$/);
    await page.getByRole("button", { name: "新建构思画布" }).first().click();
    await page.waitForURL(/\/canvas\//);
    await expect(page.getByTestId("canvas-viewport")).toBeVisible({ timeout: 30_000 });
    // 真实后端：保存状态绝不允许出现「演示模式」
    await expect(page.getByText(/演示模式/)).toHaveCount(0);

    // 资料面板 → 搜索 → 引用整条资料卡片（插入自动创建页面并触发保存）
    await page.getByRole("button", { name: "资料" }).click();
    const panel = page.getByTestId("canvas-material-panel");
    await panel.getByLabel("搜索资料").fill("真实联动速记");
    await expect(panel.getByLabel(/预览速记：真实联动速记标题/)).toBeVisible({ timeout: 15_000 });
    await panel.getByLabel(/预览速记：真实联动速记标题/).click();
    await panel.getByRole("button", { name: "引用整条资料卡片" }).click();
    const cardBlock = page.locator("[data-block-type='materialCard']");
    await expect(cardBlock.locator(".canvas-material-card-title")).toHaveText("真实联动速记标题");

    // 自动保存完成（真实落库；toast「已保存为速记」也在场，用 testid 精确锁定）
    await expect(page.getByTestId("canvas-save-status")).toHaveText(/已保存/, { timeout: 30_000 });
    // 等防抖（800ms）+ 写库完成再刷新——初始化即显示「已保存」，不能以它为保存完成信号
    await page.waitForTimeout(2000);
    await page.reload();
    await expect(page.getByTestId("canvas-viewport")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-block-type='materialCard']")).toBeVisible({ timeout: 15_000 });

    // 删除来源速记（产品同款软删 RPC，用户身份调用）→ 刷新后「来源不可用」角标
    const userClient = createClient(URL, ANON_KEY);
    const signIn = await userClient.auth.signInWithPassword({ email, password });
    expect(signIn.error).toBeNull();
    const { data: memoRows } = await userClient
      .from("memos")
      .select("id")
      .eq("content", "真实联动速记标题\n\n用于真实后端画布引用的正文。");
    const memoId = memoRows?.[0]?.id as string;
    expect(memoId).toBeTruthy();
    const { error: trashError } = await userClient.rpc("mutate_trash", {
      p_action: "soft_delete",
      p_resource_type: "memo",
      p_ids: [memoId],
    });
    expect(trashError).toBeNull();

    await page.reload();
    const card = page.locator("[data-block-type='materialCard']");
    await expect(card).toBeVisible({ timeout: 15_000 });
    // 快照内容仍在（任何状态都不隐藏已保存的画布快照）
    await expect(card.locator(".canvas-material-card-title")).toHaveText("真实联动速记标题");
    await expect(card.getByText("来源不可用")).toBeVisible({ timeout: 30_000 });
  });
});
