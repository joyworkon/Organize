"use client";

import { useEffect } from "react";
import { getPlatform } from "@/lib/platform/detect";

/**
 * 桌面壳（Tauri）全局快捷键桥接：Rust 侧注册 Cmd/Ctrl+Shift+S 并 emit
 * "quick-save" 事件；这里仅在 Tauri 运行时（window.__TAURI_INTERNALS__）
 * 动态注册监听，转成 window CustomEvent "organize:quick-save"，
 * 由 QuickAdd 打开快速保存弹层。普通浏览器 / PWA 不挂任何监听、不加载 Tauri API。
 */
export function QuickSaveBridge() {
  useEffect(() => {
    if (getPlatform() !== "tauri") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("quick-save", () => {
          window.dispatchEvent(new CustomEvent("organize:quick-save"));
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
  }, []);

  return null;
}
