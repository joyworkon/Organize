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

/** 当前是否在线（SSR 环境按在线处理，避免水合不一致） */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
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

/** React hook：在线状态随 online/offline 事件实时更新 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => isOnline());
  useEffect(() => {
    // 挂载时校正一次（SSR 快照可能过期）
    setOnline(isOnline());
    return onNetworkChange(setOnline);
  }, []);
  return online;
}
