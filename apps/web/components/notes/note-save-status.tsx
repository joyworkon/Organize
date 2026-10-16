"use client";

import { Check, Loader2, WifiOff } from "@/components/icons";
import type { NoteSaveUiState } from "@/lib/notes/note-save-session";
import { Button } from "@/components/ui/button";

/**
 * 顶栏保存状态区（纯展示）。传入 saveState 时以保存会话的 phase 为唯一保存状态来源；
 * 旧的标量 props 仅保留给尚未接入会话状态的调用方。
 */
export function NoteSaveStatus({
  online,
  offlinePending,
  pendingSyncedBlocks,
  saveError,
  saving,
  lastSaved,
  isViewer,
  saveState,
  onRetry,
}: {
  online: boolean;
  offlinePending: boolean;
  pendingSyncedBlocks: number;
  saveError: string;
  saving: boolean;
  lastSaved: Date | null;
  isViewer: boolean;
  /** 页面传 session.getUiState() 的响应式快照。 */
  saveState?: NoteSaveUiState;
  /** 由页面接到现有 flushSave；组件本身不创建重试逻辑。 */
  onRetry?: () => void;
}) {
  const phase = saveState?.phase ?? (saving ? "saving" : saveError ? "error" : "clean");
  const pending = saveState?.offlinePending ?? offlinePending;
  const error = saveState?.saveError ?? saveError;
  const savedAt = saveState ? saveState.lastSavedAt : lastSaved;
  const localWriteFailed = saveState?.localPersistence === "failed";

  let label = "";
  let detail = "";
  let statusIcon: "check" | "loading" | "offline" | null = null;
  let statusClass = "";

  if (isViewer) {
    label = "仅查看";
  } else if (phase === "conflict") {
    label = "保存冲突";
    detail = error || "其他位置有更新，请处理冲突后再保存";
    statusClass = "text-warning";
  } else if (phase === "error") {
    label = "保存失败";
    detail = error || "保存失败，请重试";
    statusClass = "text-destructive";
  } else if (phase === "saving") {
    label = "保存中";
    statusIcon = "loading";
  } else if (phase === "local-only" || !online) {
    label = "离线";
    detail = pending || phase === "local-only" ? "尚未同步" : "当前无法确认云端状态";
    statusIcon = "offline";
    statusClass = "text-warning";
  } else if (phase === "dirty") {
    label = "尚未保存";
  } else if (phase === "clean" && savedAt) {
    label = "已保存";
    detail = savedAt.toLocaleTimeString("zh-CN");
    statusIcon = "check";
    statusClass = "text-success";
  }

  if (!isViewer && localWriteFailed && phase !== "error" && phase !== "conflict") {
    detail = "设备草稿保存失败；请保持页面打开并导出内容";
    statusClass = "text-destructive";
  }

  return (
    <div className="note-save-status flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <div role="status" aria-live="polite" aria-atomic="true" className="flex min-w-0 items-center gap-2">
        {label && (
          <span className={`flex min-w-0 items-center gap-1.5 ${statusClass}`}>
            {statusIcon === "loading" && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />}
            {statusIcon === "offline" && <WifiOff className="h-3 w-3 shrink-0" aria-hidden="true" />}
            {statusIcon === "check" && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="whitespace-nowrap">{label}</span>
            {detail && (
              <span className="min-w-0 max-w-[min(50vw,18rem)] whitespace-normal break-words leading-4 md:max-w-64 md:truncate md:whitespace-nowrap">
                · {detail}
              </span>
            )}
          </span>
        )}
        {pendingSyncedBlocks > 0 && (
          <span className="shrink-0 text-warning">
            {pendingSyncedBlocks} 个同步块待同步
          </span>
        )}
      </div>
      {phase === "error" && online && !isViewer && onRetry && (
        <Button type="button" variant="outline" size="sm" className="min-h-11 px-2.5 text-xs md:min-h-11" onClick={onRetry}>
          重试保存
        </Button>
      )}
    </div>
  );
}
