"use client";

import { useEffect, useRef } from "react";
import { getPlatform } from "@/lib/platform/detect";
import { useToastStore } from "@/hooks/use-toast";

/**
 * 桌面壳（Tauri）自动更新桥：启动后延迟首查 + 每 4 小时定时 check()，
 * 有更新 → toast 提示并后台 downloadAndInstall() → 完成 toast 提供
 * 「立即重启」（relaunch() 来自 process 插件）。仅在 Tauri 运行时动态
 * import 更新插件，普通浏览器 / PWA / 移动壳零加载。
 *
 * 更新清单与签名公钥配置在 desktop/src-tauri/tauri.conf.json 的
 * plugins.updater；发布链路见 .github/workflows/desktop-release.yml。
 */
export function UpdaterBridge() {
  const busyRef = useRef(false);

  useEffect(() => {
    if (getPlatform() !== "tauri") return;

    const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
    const FIRST_CHECK_DELAY_MS = 15 * 1000;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const checkOnce = async () => {
      if (busyRef.current || cancelled) return;
      busyRef.current = true;
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update || cancelled) return;

        const { addToast } = useToastStore.getState();
        addToast({
          title: "发现新版本",
          description: `Organize ${update.version} 正在后台下载安装…`,
          duration: 8000,
        });
        // downloadAndInstall 内置进度（此处不展示百分比，装完再提示重启）
        await update.downloadAndInstall();
        if (cancelled) return;
        addToast({
          title: "更新已就绪",
          description: `Organize ${update.version} 安装完成，重启后生效。`,
          duration: 30_000,
          action: (
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              onClick={() => {
                void import("@tauri-apps/plugin-process").then(({ relaunch }) =>
                  relaunch(),
                );
              }}
            >
              立即重启
            </button>
          ),
        });
      } catch {
        // 检查/下载失败（离线、清单未发布、签名不符等）静默跳过，下个周期重试
      } finally {
        busyRef.current = false;
      }
    };

    const firstCheck = setTimeout(() => void checkOnce(), FIRST_CHECK_DELAY_MS);
    timer = setInterval(() => void checkOnce(), CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(firstCheck);
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}
