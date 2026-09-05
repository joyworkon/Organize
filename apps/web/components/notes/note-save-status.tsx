"use client";

import { Check, Loader2, WifiOff } from "lucide-react";

/**
 * 顶栏保存状态区（R08.1 自笔记页抽离，纯展示）：
 * 离线角标 / 同步块待同步 / 保存错误 / 保存中 / 已保存 / viewer 只读角标。
 * 状态值全部来自保存会话的统一派生（R07），此处不做任何业务判断。
 */
export function NoteSaveStatus({
  online,
  offlinePending,
  pendingSyncedBlocks,
  saveError,
  saving,
  lastSaved,
  isViewer,
}: {
  online: boolean;
  offlinePending: boolean;
  pendingSyncedBlocks: number;
  saveError: string;
  saving: boolean;
  lastSaved: Date | null;
  isViewer: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {!online && (
        <span className="flex items-center gap-1" role="status">
          <WifiOff className="h-3 w-3" />
          离线中{offlinePending ? " · 更改将在联网后同步" : ""}
        </span>
      )}
      {pendingSyncedBlocks > 0 && (
        <span className="text-amber-600 dark:text-amber-300" role="status">
          {pendingSyncedBlocks} 个同步块待同步
        </span>
      )}
      {saveError ? (
        <span className="text-destructive">{saveError}</span>
      ) : (
        // 例行的「保存中/已保存」是桌面端状态区的一部分；移动端顶栏
        // 只留 分享 + 更多（Notion 移动端样式），具体状态收进更多菜单
        <span className="hidden items-center gap-1.5 md:flex">
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              保存中...
            </>
          ) : lastSaved ? (
            <>
              <Check className="h-3 w-3 text-green-500" />
              已保存 {lastSaved.toLocaleTimeString("zh-CN")}
            </>
          ) : null}
        </span>
      )}
      {/* 协作 viewer：显式只读角标，解释为何没有保存状态 */}
      {isViewer && (
        <span
          className="hidden rounded border px-1.5 py-0.5 text-xs text-muted-foreground md:inline-block"
          title="这篇笔记以仅查看身份共享给你"
        >
          仅查看
        </span>
      )}
    </div>
  );
}
