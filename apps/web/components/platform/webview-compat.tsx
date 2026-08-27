"use client";

import { useEffect } from "react";

/**
 * WebView 兼容垫片：crypto.randomUUID 仅在安全上下文（https / localhost）暴露。
 * 壳层本地验证走 http://10.0.2.2 之类非安全源、或用户经局域网 IP 直连 Web 应用时，
 * 笔记/任务创建与离线队列会直接报 "crypto.randomUUID is not a function"。
 * 这里只在缺失时补一个 RFC 4122 v4 实现；生产 https 下原生存在，零影响。
 */
export function WebViewCompat() {
  useEffect(() => {
    if (typeof crypto === "undefined") return;
    const c = crypto as Crypto & { randomUUID?: () => `${string}-${string}-${string}-${string}-${string}` };
    if (typeof c.randomUUID === "function") return;
    c.randomUUID = () => {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
  }, []);

  return null;
}
