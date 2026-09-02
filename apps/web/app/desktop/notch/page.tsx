"use client";

import { useEffect, useState } from "react";
import { NotchTrigger } from "@/components/desktop/notch/notch-trigger";
import { NotchPanel } from "@/components/desktop/notch/notch-panel";
import { getPlatform } from "@/lib/platform/detect";
import { notchRoleFromLabel, type NotchWindowRole } from "@/lib/desktop/notch";

/**
 * 刘海激发器专用轻页面（桌面壳限定）：Rust 的 notch-trigger / notch-panel
 * 两个小窗加载同一路由，按 Tauri 窗口 label 分角色渲染——label 从
 * __TAURI_INTERNALS__ 元数据读取，不走 invoke、无需额外权限。
 * 普通浏览器可访问但无窗口管理，仅渲染演示态（静态预览胶囊与面板）。
 */
export default function NotchDesktopPage() {
  // SSR / 首帧渲染 null：真实窗口角色要等客户端读 __TAURI_INTERNALS__，
  // 避免 Tauri 窗口里先闪一帧浏览器演示态
  const [role, setRole] = useState<NotchWindowRole | null>(null);

  useEffect(() => {
    // 透明窗口：根页面不能带背景色，挂 body 类交给 globals.css 置透明
    document.body.classList.add("organize-notch-body");
    return () => document.body.classList.remove("organize-notch-body");
  }, []);

  useEffect(() => {
    if (getPlatform() !== "tauri") {
      setRole("demo");
      return;
    }
    let cancelled = false;
    void import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
      if (cancelled) return;
      setRole(notchRoleFromLabel(getCurrentWebviewWindow().label));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (role === "trigger") return <NotchTrigger />;
  if (role === "panel") return <NotchPanel />;
  if (role === "demo") return <NotchDemo />;
  return null;
}

/** 浏览器演示态：静态预览胶囊观感与面板布局，不加载任何 Tauri 能力 */
function NotchDemo() {
  return (
    <div className="flex min-h-screen flex-col items-center gap-8 bg-neutral-100 p-10">
      <div className="space-y-2 text-center">
        <h1 className="text-lg font-semibold">刘海激发器（演示态）</h1>
        <p className="text-sm text-muted-foreground">
          此页面供桌面壳 notch-trigger / notch-panel 窗口加载；浏览器里仅静态预览。
          真实交互（hover 展开、Enter 保存）需要 macOS 桌面壳。
        </p>
      </div>
      <div className="rounded-full bg-black px-8 py-2 opacity-40">
        <span className="text-xs text-white">⚡</span>
      </div>
      <div className="pointer-events-none scale-95 opacity-90">
        <NotchPanel />
      </div>
    </div>
  );
}
