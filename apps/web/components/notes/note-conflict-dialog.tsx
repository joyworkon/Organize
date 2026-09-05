"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { NoteSaveConflict } from "@/lib/notes/note-save-session";

/**
 * 保存冲突对话框（R08.1 自笔记页抽离，纯展示）。
 * 归因文案（066 last_edit_by）、双方版本对比、任务冲突警示与三个解决动作。
 * 默认不覆盖远端：「用本地版本覆盖」仅 note 冲突提供且为显式动作。
 */
export function NoteConflictDialog({
  conflict,
  localDraftPersistFailed,
  localTitle,
  localContentSize,
  onOverwriteRemote,
  onReloadRemote,
  onKeepLocalCopy,
}: {
  conflict: NoteSaveConflict | null;
  localDraftPersistFailed: boolean;
  localTitle: string;
  localContentSize: number;
  onOverwriteRemote: () => void;
  onReloadRemote: () => void;
  onKeepLocalCopy: () => void;
}) {
  return (
    <Dialog open={conflict !== null} onOpenChange={() => {}}>
      <DialogContent hideCloseButton>
        <DialogHeader>
          <DialogTitle>笔记存在保存冲突</DialogTitle>
          <DialogDescription>
            {conflict?.actor.kind === "self"
              ? "你的另一页面或设备已修改这篇笔记。"
              : conflict?.actor.kind === "collaborator" && conflict.actor.name
                ? `协作者「${conflict.actor.name}」已修改这篇笔记。`
                : "另一页面、设备或协作者已修改这篇笔记。"}
            {localDraftPersistFailed
              ? "云端保存存在冲突，且本机草稿写入失败——请立即导出当前内容保留副本。"
              : "当前内容没有丢失，并已保存在本地。"}
          </DialogDescription>
        </DialogHeader>
        {conflict && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs font-medium text-muted-foreground">当前本地版本</p>
              <p className="mt-1 truncate text-sm font-medium">{localTitle || "无标题"}</p>
              <p className="mt-1 text-xs text-muted-foreground">内容大小 {localContentSize} 字符</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">服务器版本</p>
              <p className="mt-1 truncate text-sm font-medium">
                {conflict.remoteDraft?.title || "无标题"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                内容大小 {JSON.stringify(conflict.remoteDraft?.content || {}).length} 字符
                {conflict.remoteUpdatedAt
                  ? ` · ${new Date(conflict.remoteUpdatedAt).toLocaleString("zh-CN")}`
                  : ""}
              </p>
            </div>
          </div>
        )}
        {conflict?.kind === "task" && (
          <p className="text-xs text-destructive">
            关联任务已被删除或发生变化，无法安全覆盖。请保留副本或重新加载服务器版本。
          </p>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={onReloadRemote}>
            重新加载服务器版本
          </Button>
          <Button variant="outline" onClick={onKeepLocalCopy}>
            保留为新副本
          </Button>
          {conflict?.kind === "note" && (
            <Button variant="destructive" onClick={onOverwriteRemote}>
              用本地版本覆盖
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
