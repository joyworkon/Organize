"use client";

import { useEffect, useState } from "react";
import { getPlatform } from "@/lib/platform/detect";
import { Button } from "@/components/ui/button";

/**
 * SW 注册与更新提示（A02）。
 * - 只在生产构建注册；dev 下顺手注销历史注册（SW 缓存会干扰 HMR/拿旧页面）。
 * - 桌面壳（tauri）与刘海小窗（/desktop）不注册：远程加载 + 本地轮询提醒，
 *   SW 的页面缓存反而可能拿旧 HTML（与 reminder-poller 双响防线一致）。
 * - 发现等待中的新版本时不强制刷新：右下角非阻塞提示，用户点「立即更新」才
 *   发 SKIP_WAITING 并刷新——避免更新瞬间丢未保存的编辑状态（笔记草稿本身
 *   有本地自动保存兜底，见 lib/notes/note-save-session.ts）。
 */
export function ServiceWorkerRegistrar() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        ?.getRegistration()
        .then((reg) => reg?.unregister())
        .catch(() => {});
      return;
    }
    // 刘海激发器等桌面壳小窗（/desktop）不注册：常驻小窗由 Tauri 管生命周期，
    // SW 的页面缓存反而可能让胶囊/面板拿到过期 HTML
    if (window.location.pathname.startsWith("/desktop")) return;
    if (getPlatform() === "tauri") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let updateTimer = 0;
    // 失败重试（A04）：注册可能在首访网络抖动/瞬时 5xx 时失败；SPA 会话内
    // registrar 不会重新挂载，不重试就整个会话失去 SW。有界退避，3 次为止。
    let attempts = 0;
    let retryTimer = 0;

    const promoteWaiting = (sw: ServiceWorker | null) => {
      // 已有 controller（非首次安装）才提示：首次安装无需用户动作
      if (sw && navigator.serviceWorker.controller) setWaitingWorker(sw);
    };

    const tryRegister = () => {
      if (cancelled) return;
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (cancelled) return;
          // 上次会话遗留的等待版本（上次提示被忽略/页面被关）
          promoteWaiting(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed") promoteWaiting(installing);
            });
          });
          // 浏览器只在导航时自动检查 SW 更新；长驻标签页每小时补一次机会
          updateTimer = window.setInterval(() => {
            reg.update().catch(() => {});
          }, 60 * 60 * 1000);
        })
        .catch((err) => {
          console.warn("SW registration failed:", err);
          if (cancelled || attempts >= 3) return;
          attempts += 1;
          retryTimer = window.setTimeout(tryRegister, 5000 * attempts);
        });
    };
    tryRegister();

    return () => {
      cancelled = true;
      window.clearInterval(updateTimer);
      window.clearTimeout(retryTimer);
    };
  }, []);

  const applyUpdate = () => {
    if (!waitingWorker) return;
    // 用户已点击（=已授权刷新）：新 SW 接管后重载加载新版本
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => window.location.reload(),
      { once: true }
    );
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  if (!waitingWorker || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border bg-background p-4 shadow-lg space-y-3"
    >
      <div className="text-sm font-medium">新版本已就绪</div>
      <p className="text-xs text-muted-foreground">
        刷新后启用新版本。笔记草稿会自动保存到本地，不会丢失。
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
          稍后
        </Button>
        <Button size="sm" onClick={applyUpdate}>
          立即更新
        </Button>
      </div>
    </div>
  );
}
