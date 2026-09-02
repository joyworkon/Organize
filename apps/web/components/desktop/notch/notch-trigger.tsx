"use client";

import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { getPlatform } from "@/lib/platform/detect";
import { readNotchTriggerHidden } from "@/lib/desktop/notch";
import { cn } from "@/lib/utils";

/**
 * 刘海胶囊（notch-trigger 窗口）：纯黑胶囊 + 极淡 ⚡，平时 ≈15% 透明度，
 * hover 升到 40% 并微加宽。mouseenter/mouseleave 只上报 Rust（150ms 停留
 * 判定在 Rust 侧防抖，快速划过不展开面板）。挂载时上报「隐藏激发器」
 * 设置决定本窗口显隐，避免已隐藏设置下的启动闪现。
 */
export function NotchTrigger() {
  const [hovered, setHovered] = useState(false);
  const [hasNotch, setHasNotch] = useState(true);
  const hoverTimers = useRef<{ enter?: ReturnType<typeof setTimeout>; leave?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    if (getPlatform() !== "tauri") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const { emit, listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      // 先挂 notch-info 监听再上报显隐设置：Rust 收到上报会回执刘海检测结论，
      // 顺序反了回执会丢（Rust 侧见 notch.rs 的 notch-trigger-visibility 处理器）
      unlisten = await listen<{ has_notch: boolean }>("notch-info", (event) => {
        setHasNotch(Boolean(event.payload?.has_notch));
      });
      // 启动上报显隐设置（Rust 侧窗口默认隐藏，收到 visible 才显示，防闪现）
      await emit("notch-trigger-visibility", { visible: !readNotchTriggerHidden() });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 透明度过渡放在 CSS（150ms），上报用短防抖避免边界抖动产生噪音事件
  function reportHover(entered: boolean) {
    setHovered(entered);
    const timers = hoverTimers.current;
    if (entered) {
      clearTimeout(timers.leave);
      timers.enter = setTimeout(() => {
        void import("@tauri-apps/api/event").then(({ emit }) =>
          emit("notch-hover", { entered: true }),
        );
      }, 30);
    } else {
      clearTimeout(timers.enter);
      timers.leave = setTimeout(() => {
        void import("@tauri-apps/api/event").then(({ emit }) =>
          emit("notch-hover", { entered: false }),
        );
      }, 30);
    }
  }

  return (
    <div className="flex h-screen w-screen items-start justify-center bg-transparent pt-[1px]">
      <div
        role="button"
        aria-label="Organize 速记激发器"
        tabIndex={-1}
        onMouseEnter={() => reportHover(true)}
        onMouseLeave={() => reportHover(false)}
        className={cn(
          "flex h-[26px] items-center justify-center gap-1.5 rounded-full bg-black transition-all duration-150 ease-out",
          hovered ? "w-[186px] opacity-40" : "w-[168px] opacity-[0.15]",
          !hasNotch && "ring-1 ring-white/20",
        )}
      >
        <Zap className="h-3 w-3 text-white" strokeWidth={2.5} fill="currentColor" />
      </div>
    </div>
  );
}
