"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 通知权限被浏览器拒绝时的可操作提示：
 * 之前只是一行灰字「通知已禁用」，用户不知道怎么办。这里点开给出按浏览器的
 * 恢复步骤，并提供「已开启，重新检测」（浏览器不允许网页再次弹权限框，只能引导用户去站点设置）。
 */
export function NotificationDeniedHelp({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
            className
          )}
        >
          🔕 通知已禁用 · 如何开启
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-sm">
        <p className="font-medium">任务到期提醒需要浏览器通知权限</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>点击地址栏左侧的站点图标（🔒 或「设置」图标）</li>
          <li>找到「通知」，改为「允许」</li>
          <li>回到这里点「重新检测」</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          macOS 还需在「系统设置 › 通知」里允许浏览器发送通知。
        </p>
        <Button size="sm" className="w-full" onClick={() => window.location.reload()}>
          已开启，重新检测
        </Button>
      </PopoverContent>
    </Popover>
  );
}
