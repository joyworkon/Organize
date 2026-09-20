import { NavigateBridge } from "@/components/desktop/navigate-bridge";
import { MemoSyncBridge } from "@/components/desktop/memo-sync-bridge";
import { NotificationNavigate } from "@/components/platform/notification-navigate";
import type { Metadata, Viewport } from "next";
import "./misans.css";
import "./globals.css";
import "./mobile.css";
import { ServiceWorkerRegistrar } from "@/components/layout/sw-registrar";
import { WebViewCompat } from "@/components/platform/webview-compat";
import { FontReadyBridge } from "@/components/platform/font-ready-bridge";

export const metadata: Metadata = {
  title: "Cairn - 智能笔记工具",
  description: "类 Notion + Cubox 的跨平台笔记与阅读管理工具",
};

/** M05：启用 viewport-fit=cover——globals.css 的 pt-safe/pb-safe/bottom-safe
 * 依赖 env(safe-area-inset-*)；不声明 cover 时这些值恒为 0，安全区规则形同虚设。
 * 真机 inset 数值的系统性验证仍按 M05 计划在原生壳上取样后进行。 */
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {children}
        <WebViewCompat />
        <NavigateBridge />
        <NotificationNavigate />
        <MemoSyncBridge />
        <FontReadyBridge />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
