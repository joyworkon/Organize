"use client";

import { useEffect } from "react";
import { getPlatform } from "@/lib/platform/detect";

interface AndroidShareDetail {
  text?: string;
  title?: string;
}

/**
 * 移动壳（Capacitor）系统分享桥：Android MainActivity 收到 ACTION_SEND 后
 * 通过 WebView 注入 "organize:android-share" 事件，这里转发为
 * "organize:share-prefill" 交给 QuickAdd 预填。
 * native 侧注入前会轮询 window.__organizeShareReady，本组件挂载后置位。
 */
export function ShareBridge() {
  useEffect(() => {
    if (getPlatform() !== "capacitor") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AndroidShareDetail>).detail;
      window.dispatchEvent(
        new CustomEvent("organize:share-prefill", { detail })
      );
    };
    window.addEventListener("organize:android-share", handler);
    (window as { __organizeShareReady?: boolean }).__organizeShareReady = true;
    return () => {
      window.removeEventListener("organize:android-share", handler);
      (window as { __organizeShareReady?: boolean }).__organizeShareReady = false;
    };
  }, []);

  return null;
}
