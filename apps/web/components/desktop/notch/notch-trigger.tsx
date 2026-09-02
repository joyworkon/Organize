"use client";

import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { getPlatform } from "@/lib/platform/detect";
import { readNotchTriggerHidden } from "@/lib/desktop/notch";
import { cn } from "@/lib/utils";

/**
 * 刘海胶囊 / 副屏透明把手（notch-trigger-{i} 窗口）：纯黑胶囊 + 极淡 ⚡，
 * 平时 ≈15% 透明度，hover 升到 40% 并微加宽（方案决策 2）。
 *
 * v1.1：窗口 set_ignore_cursor_events(true) 纯视觉穿透，本组件不再上报
 * DOM mouseenter/leave（应用未激活时 WKWebView 鼠标事件不可靠，v1 实测
 * 「必须点一下才弹」的根因）；hover 判定在 Rust 侧光标轮询里做，这里只
 * 监听 notch-hover-broadcast 做视觉反馈。挂载时上报「隐藏激发器」设置
 * 决定本窗口显隐，避免已隐藏设置下的启动闪现。
 */
export function NotchTrigger() {
  const [hovered, setHovered] = useState(false);
  const [hasNotch, setHasNotch] = useState(true);

  useEffect(() => {
    if (getPlatform() !== "tauri") return;
    let cancelled = false;
    let unlistenHover: (() => void) | undefined;
    let unlistenInfo: (() => void) | undefined;

    void (async () => {
      const { emit, listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;
      // 先挂监听再上报显隐设置：Rust 收到上报会回执刘海检测结论，
      // 顺序反了回执会丢（Rust 侧见 notch.rs 的 notch-trigger-visibility 处理器）
      unlistenInfo = await listen<{ has_notch: boolean }>("notch-info", (event) => {
        setHasNotch(Boolean(event.payload?.has_notch));
      });
      // hover 视觉反馈：Rust 光标轮询判定命中任一胶囊后广播（广播 vs emit_to：
      // JS listen 默认只匹配 Any 目标，单监听即可，多屏胶囊窗口行为一致）
      unlistenHover = await listen<{ entered: boolean }>("notch-hover-broadcast", (event) => {
        setHovered(Boolean(event.payload?.entered));
      });
      // 启动上报显隐设置（Rust 侧窗口默认隐藏，收到 visible 才显示，防闪现）
      await emit("notch-trigger-visibility", { visible: !readNotchTriggerHidden() });
    })();

    return () => {
      cancelled = true;
      unlistenHover?.();
      unlistenInfo?.();
    };
  }, []);

  return (
    // 透明窗口：根页面不能带背景色（globals.css 的 organize-notch-body 置透明）
    <div className="flex h-screen w-screen items-start justify-center bg-transparent pt-[1px]">
      <div
        role="button"
        aria-label="Organize 速记激发器"
        tabIndex={-1}
        className={cn(
          "flex h-[26px] items-center justify-center gap-1.5 rounded-full bg-black transition-all duration-150 ease-out",
          hovered ? "w-[186px] opacity-40" : "w-[168px] opacity-[0.15]",
          // 副屏 / 无刘海屏：胶囊悬浮在菜单栏上，加一圈描边当「把手」提示
          !hasNotch && "ring-1 ring-white/25",
        )}
      >
        <Zap className="h-3 w-3 text-white" strokeWidth={2.5} fill="currentColor" />
      </div>
    </div>
  );
}
