/// <reference lib="webworker" />

const CACHE_NAME = "organize-v1";
const STATIC_ASSETS = ["/", "/inbox", "/library", "/notes", "/plugins"];

// 安装时缓存静态资源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 网络优先策略，失败时回退缓存
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理同源 GET 请求
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // API 请求不缓存
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // 缓存成功的页面响应
        if (response.ok && request.headers.get("accept")?.includes("text/html")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          return cached || caches.match("/");
        });
      })
  );
});

// 监听来自主线程的消息（离线操作队列）
self.addEventListener("message", (event) => {
  if (event.data?.type === "SYNC_PENDING") {
    // 触发后台同步
    if ("sync" in self.registration) {
      self.registration.sync.register("organize-sync");
    }
  }
});
