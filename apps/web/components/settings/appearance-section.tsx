"use client";

import { Moon, MonitorSmartphone, Palette, Sun } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useThemeMode, type ThemeMode } from "@/hooks/use-theme-mode";

const OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  icon: typeof Sun;
}> = [
  { id: "system", label: "跟随系统", icon: MonitorSmartphone },
  { id: "light", label: "亮色", icon: Sun },
  { id: "dark", label: "暗色", icon: Moon },
];

/**
 * 设置页「外观」分区。
 * 改版前这里只有一句"明暗请去侧栏底部切换"的说明文字，是个没有控件的空分区；
 * 现在把明暗模式做成三档分段控件（跟随系统 / 亮色 / 暗色），与侧栏按钮同源。
 */
export function AppearanceSection() {
  const { mode, dark, setMode } = useThemeMode();

  return (
    <section className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Palette className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">外观</h2>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">明暗模式</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {mode === "system"
              ? `跟随系统，当前为${dark ? "暗色" : "亮色"}`
              : `固定为${mode === "dark" ? "暗色" : "亮色"}`}
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="明暗模式"
          className="flex w-fit shrink-0 gap-1 rounded-lg bg-muted p-1"
        >
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(option.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  selected
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        Cairn 使用单一品牌色（石板蓝），不提供主题色切换——彩色只留给可点的地方与状态提示，
        其余界面一律中性灰，避免颜色抢走内容的注意力。
      </p>
    </section>
  );
}
