"use client";

import { useEffect } from "react";
import { getPlatform } from "@/lib/platform/detect";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // 刘海激发器等桌面壳小窗（/desktop）不注册：常驻小窗由 Tauri 管生命周期，
    // SW 的页面缓存反而可能让胶囊/面板拿到过期 HTML
    if (window.location.pathname.startsWith("/desktop")) return;
    // Tauri 壳不注册：主窗加载远程页，SW 页面缓存同理拿旧 HTML；任务提醒
    // 走本地轮询 + 原生通知（components/desktop/reminder-poller.tsx），壳内
    // 不订阅 Web Push（use-notifications 仅 web 平台订阅）避免与轮询双响
    if (getPlatform() === "tauri") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("SW registration failed:", err));
    }
  }, []);

  return null;
}
