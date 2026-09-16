"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 明暗模式的唯一状态源。
 *
 * 改版前明暗只有侧栏底部一个图标按钮，逻辑（localStorage + matchMedia + html class）
 * 内联在 theme-toggle.tsx 里；设置页「外观」分区因此只能写一句"请去侧栏切换"的说明。
 * 本 hook 把这套逻辑抽出来（ui-change-guide §4 要求 matchMedia 出现第三处前先抽 hook），
 * 让侧栏按钮与设置页分区共用一份状态，并通过自定义事件互相同步，避免两处图标/选中态打架。
 *
 * 存储语义沿用原键 `organize-theme`：
 * - "dark" / "light" = 用户显式选择
 * - 键不存在 = 跟随系统（原实现也是这个语义，这里只是把它显式化为 "system" 档）
 */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "organize-theme";
const CHANGE_EVENT = "organize:theme-mode-change";

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && systemPrefersDark());
}

/** 写入模式并广播；html class 由监听方统一落地，避免两条写入路径 */
export function setThemeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  if (mode === "system") window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useThemeMode() {
  // SSR 首帧一律按 system/亮色渲染，挂载后再同步真实值（与原实现一致）
  const [mode, setMode] = useState<ThemeMode>("system");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const sync = () => {
      const next = readThemeMode();
      const nextDark = resolveDark(next);
      setMode(next);
      setDark(nextDark);
      document.documentElement.classList.toggle("dark", nextDark);
    };
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    // 跟随系统档下，系统换明暗要即时生效
    mq?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      mq?.removeEventListener?.("change", sync);
    };
  }, []);

  const apply = useCallback((next: ThemeMode) => setThemeMode(next), []);
  const toggle = useCallback(() => {
    setThemeMode(resolveDark(readThemeMode()) ? "light" : "dark");
  }, []);

  return { mode, dark, setMode: apply, toggle };
}
