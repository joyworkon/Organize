"use client";

import { Moon, Sun } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useThemeMode } from "@/hooks/use-theme-mode";

/** 侧栏底部的明暗快捷开关；状态与设置页「外观」分区共用 use-theme-mode */
export function ThemeToggle() {
  const { dark, toggle } = useThemeMode();

  return (
    <button
      onClick={toggle}
      className={cn(
        "p-2 rounded-md transition-all duration-200",
        "hover:bg-accent hover:text-accent-foreground",
        "text-muted-foreground"
      )}
      title={dark ? "切换到亮色模式" : "切换到暗色模式"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
