import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/layout/sw-registrar";
import { WebViewCompat } from "@/components/platform/webview-compat";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Organize - 智能笔记工具",
  description: "类 Notion + Cubox 的跨平台笔记与阅读管理工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={inter.className}>
        {children}
        <WebViewCompat />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
