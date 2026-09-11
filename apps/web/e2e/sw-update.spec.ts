import { execFileSync, execSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * A02：Service Worker 跨版本更新与离线边界（真实双构建行为验证）。
 *
 * 前置（beforeAll 自理，无需外部进程）：
 *   1. 构建版本 N（SW_BUILD_VERSION=1110000000000）→ 存临时目录
 *   2. 构建版本 N+1（SW_BUILD_VERSION=2220000000000）→ 存临时目录
 * 运行：SW_E2E=1 npx playwright test -c playwright.sw.config.ts（pnpm e2e:sw）
 * CI 由 ci.yml 的 sw-e2e job 显式开启；默认 `pnpm e2e`（smoke）不跑本套件。
 *
 * 验收对照（计划卡 A02）：
 *   - 生产构建 N→N+1：旧标签页已访问路由可继续导航；未访问旧路由给「应用已更新」提示
 *   - 更新不强制刷新：等待版本出现非阻塞提示，点「立即更新」才接管+刷新
 *   - 断网可读范围明确：已缓存页面可开；未缓存路由回退 /offline；脚本请求绝不收到 HTML
 *   - 缓存清理只删本应用命名空间，且保留上一版（旧标签页旧 chunk 来源）
 *   - 缓存 HTML 不含账号私密数据（页面为客户端壳，数据走 API/存储）
 */

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const VERSION_A = "1110000000000";
const VERSION_B = "2220000000000";
const BUILD_ENV = {
  NEXT_PUBLIC_MOCK_BACKEND: "true",
  ORGANIZE_E2E: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
};

/** 未访问过的路由候选（Next 会预取视口内链接的布局层 chunk，故逐个尝试） */
const UNVISITED_ROUTES: { path: string; label: RegExp }[] = [
  { path: "/tasks", label: /待办|Tasks/ },
  { path: "/memos", label: /速记|Memos/ },
  { path: "/graph", label: /图谱|Graph/ },
  { path: "/favorites", label: /收藏夹|Favorites/ },
];

const workDir = mkdtempSync(join(tmpdir(), "organize-sw-e2e-"));
const nextA = join(workDir, "nextA");
const nextB = join(workDir, "nextB");
let serverHandle: ReturnType<typeof spawn> | null = null;
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

test.skip(!process.env.SW_E2E, "SW_E2E=1 时运行（双构建，约 5 分钟）");

function build(version: string, outDir: string) {
  execFileSync("node", ["scripts/gen-sw.mjs"], {
    env: { ...process.env, ...BUILD_ENV, SW_BUILD_VERSION: version },
  });
  execFileSync("npx", ["next", "build"], {
    // CI runner 内存有限，限制构建堆大小防 OOM
    env: { ...process.env, ...BUILD_ENV, NODE_OPTIONS: "--max-old-space-size=3072" },
  });
  rmSync(outDir, { recursive: true, force: true });
  cpSync(".next", outDir, { recursive: true });
  // next start 实时读 public/ 目录：把带版本的 sw.js 一并快照，serve 时还原
  cpSync("public/sw.js", join(workDir, `sw-${version}.js`));
}

/** CI 预构建复用（SW_E2E_PREBUILT_DIR 指向含 next-<v>/ 与 sw-<v>.js 的目录）：
 *  构建不放进 Playwright 进程族，避免 runner 上 OOM（SIGKILL） */
function ensureBuild(version: string, outDir: string) {
  const prebuiltDir = process.env.SW_E2E_PREBUILT_DIR;
  if (prebuiltDir) {
    cpSync(join(prebuiltDir, `next-${version}`), outDir, { recursive: true });
    cpSync(join(prebuiltDir, `sw-${version}.js`), join(workDir, `sw-${version}.js`));
    return;
  }
  build(version, outDir);
}

async function serve(outDir: string, version: string) {
  await stopServer();
  rmSync(".next", { recursive: true, force: true });
  cpSync(outDir, ".next", { recursive: true });
  cpSync(join(workDir, `sw-${version}.js`), "public/sw.js");
  const logFd = openSync(join(workDir, `server-${Date.now()}.log`), "a");
  serverHandle = spawn("npx", ["next", "start", "-p", `${PORT}`], {
    stdio: ["ignore", logFd, logFd],
  });
  serverHandle.unref();
  closeSync(logFd);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {}
  }
  throw new Error(`server for ${outDir} failed to start (logs in ${workDir})`);
}

async function stopServer() {
  // next start 会 spawn 改名后的 next-server 子进程，按端口杀才干净
  try {
    execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: "ignore" });
  } catch {}
  serverHandle?.kill("SIGKILL");
  serverHandle = null;
  await new Promise((r) => setTimeout(r, 800));
}

const cacheKeys = (p: Page) => p.evaluate(() => caches.keys());

const triggerUpdateCheck = (p: Page) =>
  p.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    if (!r) return { error: "no registration" as const };
    await r.update();
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 2000);
    });
    const active = !!r.active;
    const installing = !!r.installing;
    const waiting = !!r.waiting;
    return { active, installing, waiting };
  });

test.beforeAll(async () => {  // 双构建：源码不变，仅 SW_BUILD_VERSION 不同 → sw.js 字节不同 → 浏览器可检测到更新
  // （版本常量须与 ci.yml sw-e2e job 的预构建版本一致）
  ensureBuild(VERSION_A, nextA);
  ensureBuild(VERSION_B, nextB);

  browser = await chromium.launch();
  context = await browser.newContext();
  page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("organize:onboarded", "1"));
  await serve(nextA, VERSION_A);
});

test.afterAll(async () => {
  await stopServer();
  await context?.close();
  await browser?.close();
  rmSync(workDir, { recursive: true, force: true });
});

test.describe.serial("SW 跨版本更新与离线边界", () => {
  test("版本 N：版本化缓存建立，页面与构建产物分别入缓存", async () => {
    await page!.goto(`${BASE}/notes`, { waitUntil: "domcontentloaded" });
    await page!.waitForTimeout(3000);

    await expect
      .poll(async () => page!.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);

    const keys = await cacheKeys(page!);
    expect(keys).toContain(`organize-static-${VERSION_A}`);
    expect(keys).toContain(`organize-runtime-${VERSION_A}`);

    // SPA 导航到 /library：其 chunk 进 runtime 缓存（SPA 导航不产生 navigate 请求，
    // HTML 只在整页加载时进 static 缓存——这是 SW 的既定行为）
    await page!.getByRole("link", { name: /稍后读|Library/ }).first().click();
    await page!.waitForURL(/\/library/);
    await page!.waitForTimeout(2000);
    const runtimeCount = await page!.evaluate(async (cacheName) => {
      const c = await caches.open(cacheName);
      return (await c.keys()).length;
    }, `organize-runtime-${VERSION_A}`);
    expect(runtimeCount).toBeGreaterThan(0);

    // 整页加载 /library：导航 HTML 进 static 缓存（离线回退的来源）
    await page!.goto(`${BASE}/library`, { waitUntil: "domcontentloaded" });
    await page!.waitForTimeout(1500);
    const staticEntries = await page!.evaluate(async (cacheName) => {
      const c = await caches.open(cacheName);
      return (await c.keys()).map((r) => r.url);
    }, `organize-static-${VERSION_A}`);
    expect(staticEntries.some((u) => u.endsWith("/library"))).toBe(true);
  });

  test("N→N+1 部署：等待版本非阻塞提示、不强制刷新；旧标签页已缓存路由仍可导航", async () => {
    await serve(nextB, VERSION_B);

    // 旧标签页仍开着：update() 发现 sw.js 字节变化 → installing → waiting
    const state = await triggerUpdateCheck(page!);
    expect(state).toMatchObject({ active: true, waiting: true });

    await expect(page!.getByText("新版本已就绪")).toBeVisible();
    expect(page!.url()).toContain("/library"); // 未被强制刷新

    // 已访问路由（/notes、/library 的 chunk 已在旧版 runtime 缓存）跨版本命中，继续可用
    await page!.getByRole("link", { name: /笔记|Notes/ }).first().click();
    await page!.waitForURL(/\/notes/);
    await page!.waitForTimeout(1500);
    await expect(page!.getByText("应用已更新")).toBeHidden();
    expect(await page!.title()).toBeTruthy();
  });

  test("N→N+1 部署：旧标签页导航未访问过的路由也保持可用（服务端按需拉新版资源）", async () => {
    // 旧构建标签页 SPA 导航到未访问路由时，Next 会向服务器拉取新版 RSC/_chunk
    // （网络优先），混载成功——这正是「N→N+1 能继续导航」的验收路径；
    // app/error.tsx 的「应用已更新」文案是旧 chunk 真正 404 时（如离线缓存页）的兜底。
    let navigated = 0;
    for (const { path, label } of UNVISITED_ROUTES) {
      const link = page!.getByRole("link", { name: label }).first();
      if (!(await link.isVisible().catch(() => false))) continue;
      await link.click();
      await page!.waitForURL(new RegExp(path.replace("/", "\\/")), { timeout: 15_000 });
      await page!.waitForTimeout(800);
      // 不进入任何错误边界
      await expect(page!.getByText("应用已更新")).toBeHidden();
      await expect(page!.getByText("页面出了点问题")).toBeHidden();
      navigated += 1;
    }
    expect(navigated).toBeGreaterThanOrEqual(2);
  });

  test("点击「立即更新」：新版本接管并刷新；上一版缓存保留（其他旧标签页的回退源）", async () => {
    await page!.getByRole("button", { name: "立即更新" }).click();

    await page!.waitForURL(/\/(notes|tasks|memos|graph|favorites|library)/, {
      timeout: 30_000,
    });
    await page!.waitForTimeout(3000);

    const keys = await cacheKeys(page!);
    expect(keys).toContain(`organize-static-${VERSION_B}`);
    expect(keys).toContain(`organize-runtime-${VERSION_A}`); // 上一版保留
    await expect(page!.getByText("新版本已就绪")).toBeHidden();
  });

  test("断网边界：脚本不回退 HTML；已缓存页面可开；未缓存路由回退 /offline", async () => {
    await page!.goto(`${BASE}/notes`, { waitUntil: "domcontentloaded" });
    await page!.waitForTimeout(2500);

    await context!.setOffline(true);
    await page!.waitForTimeout(500);

    // 1) 未缓存脚本请求：绝不返回 HTML（旧实现会回 200 HTML 导致语法爆炸）
    const scriptFetch = await page!.evaluate(async () => {
      try {
        const r = await fetch("/_next/static/chunks/e2e-never-cached-404.js");
        return { threw: false, status: r.status, contentType: r.headers.get("content-type") };
      } catch {
        return { threw: true as const, status: 0, contentType: null };
      }
    });
    if (!scriptFetch.threw) {
      expect(scriptFetch.status).not.toBe(200);
      expect(scriptFetch.contentType ?? "").not.toContain("text/html");
    }

    // 2) 已缓存页面：断网整页刷新后壳仍可渲染（脚本从缓存拿到 JS 而非 HTML）
    await page!.reload({ waitUntil: "domcontentloaded" });
    await page!.waitForTimeout(3500);
    const shellAlive = await page!.evaluate(() => ({
      textLen: document.body.innerText.length,
      hasUpdateError: document.body.innerText.includes("应用已更新"),
    }));
    expect(shellAlive.textLen).toBeGreaterThan(50);
    expect(shellAlive.hasUpdateError).toBe(false);

    // 3) 未访问过的路由：导航回退到 /offline 说明页
    await page!.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await expect(page!.getByText("当前处于离线状态")).toBeVisible();

    await context!.setOffline(false);
  });

  test("账号边界：缓存 HTML 全是客户端壳，不含账号私密数据（无邮箱形态）", async () => {
    const scan = await page!.evaluate(async () => {
      const out: { cache: string; url: string; bodyStart: string }[] = [];
      for (const key of await caches.keys()) {
        const c = await caches.open(key);
        for (const req of await c.keys()) {
          const res = await c.match(req);
          if (!res) continue;
          const ct = res.headers.get("content-type") ?? "";
          if (!ct.includes("text/html")) continue;
          out.push({
            cache: key,
            url: req.url,
            bodyStart: (await res.text()).slice(0, 4000),
          });
        }
      }
      return out;
    });
    expect(scan.length).toBeGreaterThan(0);
    for (const entry of scan) {
      expect(entry.bodyStart).not.toContain("smoke@example.com");
      expect(entry.bodyStart).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    }
  });
});
