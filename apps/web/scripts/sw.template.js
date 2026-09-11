/// <reference lib="webworker" />

// 模板文件：由 scripts/gen-sw.mjs 在构建时替换版本占位符后生成 public/sw.js。
// 不要直接改生成的 public/sw.js（该文件不入库）。
//
// A02 设计要点：
// - __SW_BUILD_VERSION__ 是构建时间戳：sw.js 字节随构建变化，浏览器才能检测到
//   「有新版本」；缓存名带版本，新旧构建的资产互不覆盖。
// - 安装时不无条件 skipWaiting：等页面上的用户确认（SKIP_WAITING 消息）再接管，
//   更新不强制刷新、不丢未保存的编辑状态（安全激活流程）。
// - 按请求类型分流回退：只有导航请求允许 HTML 回退（最终到零依赖的
//   /offline.html 静态页）；脚本/静态资源绝不回退 HTML（旧实现把 / 的 HTML
//   回给脚本导致语法错误）。
// - 缓存清理只处理本应用命名空间（organize- 前缀），且保留最近一个旧版本，
//   让尚未刷新的旧标签页仍能取到旧 chunk。

const BUILD_VERSION = "__SW_BUILD_VERSION__";
const CACHE_PREFIX = "organize-";
const STATIC_CACHE = `organize-static-${BUILD_VERSION}`; // 导航 HTML（跟随构建版本）
const RUNTIME_CACHE = `organize-runtime-${BUILD_VERSION}`; // /_next/static 构建产物
const OFFLINE_URL = "/offline.html";
// 预缓存最小壳：/ （未登录时 middleware 会重定向 /login，最终响应照样入缓存）
// 与零依赖的静态离线说明页（纯 HTML 无 JS，离线回退不需要任何 chunk）
const PRECACHE_URLS = ["/", OFFLINE_URL];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

function cacheVersionOf(name) {
  const m = name.match(/-(\d+)$/);
  return m ? Number(m[1]) : -1;
}

// 激活清理：保留「当前版本 + 数字版本最大的旧版本」，删除更早的版本与无版本号
// 的遗留缓存（如 organize-v3）。跨两个版本仍未刷新的旧标签页取不到旧 chunk 时，
// 会走页面的「应用已更新」提示（app/error.tsx），刷新即恢复。
async function cleanupOldCaches() {
  const keys = await caches.keys();
  const byVersion = new Map();
  for (const key of keys) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    const v = cacheVersionOf(key);
    byVersion.set(v, [...(byVersion.get(v) ?? []), key]);
  }
  const doomed = [];
  const oldVersions = [...byVersion.keys()]
    .filter((v) => v >= 0 && v !== Number(BUILD_VERSION))
    .sort((a, b) => b - a);
  for (const v of oldVersions.slice(1)) doomed.push(...byVersion.get(v));
  for (const [v, names] of byVersion) {
    if (v < 0) doomed.push(...names);
  }
  await Promise.all(doomed.map((name) => caches.delete(name)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanupOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function putClone(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // 缓存写失败（隐私模式/配额满）不影响响应本身
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // 1) 导航请求：网络优先 → 各版本缓存里的同 URL 页面 → /offline 静态页。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) putClone(STATIC_CACHE, request, response.clone());
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match(request)) ?? (await caches.match(OFFLINE_URL));
          return cached ?? Response.error();
        })
    );
    return;
  }

  // 2) 构建产物（URL 带内容哈希，天然版本隔离）：cache-first。caches.match 不限定
  //    缓存名，跨版本命中——未刷新的旧标签页仍能取到旧版本缓存里的旧 chunk。
  //    404 等错误响应原样透传，不伪造成功。
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) putClone(RUNTIME_CACHE, request, response.clone());
            return response;
          })
      )
    );
    return;
  }

  // 3) 其余同源 GET（favicon 等）：直接走网络，不缓存不回退，行为最小化。
});

// ---- Web Push 与通知点击（A02 之前既有行为，保持不变） ----

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "任务提醒", body: event.data?.text() || "" };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "任务提醒", {
      body: payload.body || "有一项任务需要处理",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: payload.tag || "organize-task-reminder",
      data: { url: payload.url || "/tasks" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/tasks", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const visibleClient = clients.find((client) => "focus" in client);
      if (visibleClient) {
        visibleClient.navigate(targetUrl);
        return visibleClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
