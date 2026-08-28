"use client";

import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Notion 风格移动端底部操作栏：左搜索、右新建两个悬浮圆钮。
 * 导航不再放底部（走顶栏汉堡抽屉）；搜索复用全局命令面板，
 * 新建复用 QuickAdd 面板，均通过 window 事件解耦。
 */
export function MobileBottomBar() {
  return (
    <nav
      className="pointer-events-none fixed left-0 right-0 z-50 flex items-center justify-between px-4 pb-safe md:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
      aria-label="移动端快捷操作"
    >
      <button
        type="button"
        aria-label="搜索"
        title="搜索"
        onClick={() => window.dispatchEvent(new CustomEvent("organize:command-palette"))}
        className={cn(
          "pointer-events-auto grid h-12 w-12 place-items-center rounded-full",
          "border bg-card/95 text-muted-foreground shadow-md backdrop-blur",
          "transition-all duration-150 hover:text-foreground active:scale-95"
        )}
      >
        <Search className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="新建"
        title="新建"
        onClick={() => window.dispatchEvent(new CustomEvent("organize:quick-add"))}
        className={cn(
          "pointer-events-auto grid h-12 w-12 place-items-center rounded-full",
          "bg-primary text-primary-foreground shadow-md",
          "transition-all duration-150 hover:scale-105 active:scale-95"
        )}
      >
        <Plus className="h-6 w-6" />
      </button>
    </nav>
  );
}
