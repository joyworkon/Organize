"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { getPlatform } from "@/lib/platform/detect";
import { NOTCH_TRIGGER_HIDDEN_KEY } from "@/lib/desktop/notch";
import { cn } from "@/lib/utils";

/**
 * 设置页「桌面端」节（仅 Tauri 壳渲染）：隐藏刘海激发器开关（方案默认值 4）。
 * 状态存 localStorage（各窗口同源共享）；切换时 emit notch-trigger-visibility
 * 由 Rust 即时显隐胶囊窗口，⌘⇧M 面板不受影响。
 */
export function NotchTriggerSetting() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (getPlatform() !== "tauri") return;
    try {
      setVisible(window.localStorage.getItem(NOTCH_TRIGGER_HIDDEN_KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);

  if (getPlatform() !== "tauri") return null;

  function toggle() {
    const next = !visible;
    setVisible(next);
    try {
      window.localStorage.setItem(NOTCH_TRIGGER_HIDDEN_KEY, next ? "0" : "1");
    } catch {
      // 存不进去也照样通知 Rust 显隐，只是重启后回落默认（显示）
    }
    void import("@tauri-apps/api/event").then(({ emit }) =>
      emit("notch-trigger-visibility", { visible: next }),
    );
  }

  return (
    <div className="p-5 border-b">
      <div className="flex items-center gap-2 mb-3">
        <Monitor className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">桌面端</h2>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">显示刘海激发器</p>
          <p className="text-sm text-muted-foreground">
            顶部刘海处的速记胶囊。隐藏后仍可用 ⌘⇧M 唤出速记面板。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={visible}
          onClick={toggle}
          className={cn(
            "relative h-6 w-11 flex-none rounded-full transition-colors",
            visible ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
              visible ? "left-[22px]" : "left-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}
