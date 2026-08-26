/**
 * 宿主平台检测：同一份前端代码运行在三种壳里——
 * - web：普通浏览器（含 PWA）
 * - tauri：Tauri 2 桌面壳（Mac / Windows）
 * - capacitor：Capacitor 移动壳（Android / iOS）
 *
 * 检测只读全局注入标记，不产生副作用；env 可注入便于测试。
 */

export type HostPlatform = "web" | "tauri" | "capacitor";

export interface PlatformEnv {
  /** Tauri 2 运行时注入的内部标记 */
  __TAURI_INTERNALS__?: unknown;
  /** Capacitor 运行时注入的全局对象 */
  Capacitor?: { isNativePlatform?: () => boolean };
}

export function detectPlatform(env?: PlatformEnv): HostPlatform {
  const global = (env ??
    (typeof window !== "undefined"
      ? (window as unknown as PlatformEnv)
      : {})) as PlatformEnv;

  if (global.__TAURI_INTERNALS__) return "tauri";
  try {
    if (global.Capacitor?.isNativePlatform?.()) return "capacitor";
  } catch {
    // Capacitor 对象存在但不可调用时按 web 处理
  }
  return "web";
}

/** 当前平台（浏览器/壳内调用；SSR 返回 "web"） */
export function getPlatform(): HostPlatform {
  return detectPlatform();
}
