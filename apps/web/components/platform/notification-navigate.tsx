"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { NOTIFICATION_NAVIGATE_EVENT } from "@/lib/platform/notifications";
import { sanitizeNavigatePath } from "@/lib/platform/navigate";

/**
 * 系统通知点击导航桥：web 平台的构造式通知（lib/platform/notifications 的
 * web notifier）点击后经窗口事件派发应用内路径，这里统一监听并转成
 * SPA 路由跳转。路径经 sanitizeNavigatePath 复检（事件通道对任意前端
 * 代码可达，与 tauri navigate 通道同一威胁模型）。
 */
export function NotificationNavigate() {
  const router = useRouter();
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const path = sanitizeNavigatePath((event as CustomEvent<unknown>).detail);
      if (path) router.push(path);
    };
    window.addEventListener(NOTIFICATION_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NOTIFICATION_NAVIGATE_EVENT, onNavigate);
  }, [router]);

  return null;
}
