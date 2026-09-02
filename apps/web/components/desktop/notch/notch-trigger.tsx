"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { getPlatform } from "@/lib/platform/detect";
import { readNotchTriggerHidden } from "@/lib/desktop/notch";
import { cn } from "@/lib/utils";

/** 窗口内胶囊的物理位置：窗口 180px 宽，胶囊 168px 宽。 */
const CAPSULE_LEFT = 6;

/**
 * 刘海胶囊 / 副屏透明把手（notch-trigger-{i} 窗口）。鼠标状态由 Rust 全局
 * 光标轮询提供；当前窗口只消费自己的 trigger 索引，避免多屏视觉串扰。
 */
export function NotchTrigger() {
  const [hovered, setHovered] = useState(false);
  const [near, setNear] = useState(false);
  const [hasNotch, setHasNotch] = useState(false);

  useEffect(() => {
    if (getPlatform() !== "tauri") return;
    let cancelled = false;
    let unlistenHover: (() => void) | undefined;
    let unlistenInfo: (() => void) | undefined;

    void (async () => {
      const [{ emit, listen }, { getCurrentWebviewWindow }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/webviewWindow"),
      ]);
      const match = /notch-trigger-(\d+)/.exec(getCurrentWebviewWindow().label);
      const ownTriggerIndex = match ? Number(match[1]) : null;
      if (cancelled || ownTriggerIndex == null) return;

      unlistenInfo = await listen<{ trigger: number; has_notch: boolean }>("notch-info", (event) => {
        if (event.payload?.trigger === ownTriggerIndex) {
          setHasNotch(Boolean(event.payload.has_notch));
        }
      });
      unlistenHover = await listen<{
        entered: boolean;
        trigger: number | null;
        near: number | null;
      }>("notch-hover-broadcast", (event) => {
        const { entered, trigger, near: nearIndex } = event.payload ?? {};
        setHovered(Boolean(entered) && trigger === ownTriggerIndex);
        setNear(nearIndex === ownTriggerIndex && trigger == null);
      });
      await emit("notch-trigger-visibility", { visible: !readNotchTriggerHidden() });
    })();

    return () => {
      cancelled = true;
      unlistenHover?.();
      unlistenInfo?.();
    };
  }, []);

  const showHints = hasNotch && near && !hovered;

  return (
    <div className="relative flex h-screen w-screen items-start justify-center bg-transparent pt-[1px]">
      {showHints && (
        <>
          <span className="organize-notch-hint" style={{ left: CAPSULE_LEFT + 14 }} aria-hidden />
          <span className="organize-notch-hint" style={{ right: CAPSULE_LEFT + 14 }} aria-hidden />
        </>
      )}
      <div
        role="presentation"
        className={cn(
          "organize-notch-capsule flex h-[26px] items-center justify-center gap-1.5 rounded-full transition-all duration-150 ease-out",
          hovered ? "w-[186px] opacity-40" : "w-[168px] opacity-[0.15]",
          !hasNotch && "ring-1 ring-white/25",
        )}
      >
        <Zap className="h-3 w-3 text-white" strokeWidth={2.5} fill="currentColor" />
      </div>
    </div>
  );
}
