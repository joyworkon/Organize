"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPlatform } from "@/lib/platform/detect";
import { sanitizeNavigatePath } from "@/lib/platform/navigate";

/**
 * 桌面壳（Tauri）托盘导航桥：Rust 托盘菜单「打开速记」等入口 emit
 * "navigate" 事件（载荷为应用内路径）；这里仅在 Tauri 运行时
 * （window.__TAURI_INTERNALS__）监听，经 sanitizeNavigatePath 校验后
 * 转成主窗口路由跳转。普通浏览器 / PWA 不挂监听、不加载 Tauri API。
 */
export function NavigateBridge() {
  const router = useRouter();
  useEffect(() => {
    if (getPlatform() !== "tauri") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("navigate", (event) => {
          const path = sanitizeNavigatePath(event.payload);
          if (path) router.push(path);
        }),
      )
      .then((fn) => {
        if (cancelled) fn?.();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [router]);

  return null;
}
