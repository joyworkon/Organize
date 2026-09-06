"use client";

/**
 * 网络状态探测（X1 离线同步）：
 * - isOnline / onNetworkChange：非 React 环境可用的基础工具
 * - useOnlineStatus：React hook，跟随 online/offline 事件实时更新
 *
 * 注意：navigator.onLine 只能判断「系统是否有网络连接」，不能保证服务器可达；
 * 真正的失败仍由保存 RPC 的错误分类兜底（见 note-sync.ts）。
 */

import { useEffect, useState } from "react";

/**
 * 当前是否在线。
 * SSR 环境按在线处理；Node 22 存在全局 navigator 但 onLine 为 undefined，
 * 因此必须显式校验布尔类型后返回，保证任何环境下都返回 boolean（F06）。
 */
export function isOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") {
    return true;
  }
  return navigator.onLine;
}

/** 注册网络状态监听，返回取消函数 */
export function onNetworkChange(callback: (online: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}

/**
 * React hook：在线状态随 online/offline 事件实时更新。
 * 首帧固定与 SSR 快照（在线）一致，挂载后校正为真实状态并订阅事件，
 * 避免客户端首帧读取 navigator.onLine 与服务端渲染不一致导致水合错误（F06）。
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(isOnline());
    return onNetworkChange(setOnline);
  }, []);
  return online;
}
