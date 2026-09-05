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
import type { StoredNoteDraft } from "@/lib/notes/local-draft";

/**
 * 本地草稿恢复对话框（R08.1 自笔记页抽离，纯展示）。
 * 打开/关闭由 recoveryDraft 是否存在驱动；选择恢复或使用服务器版本。
 */
export function NoteRecoveryDialog({
  recoveryDraft,
  onRestore,
  onDiscard,
}: {
  recoveryDraft: StoredNoteDraft | null;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog open={recoveryDraft !== null} onOpenChange={() => {}}>
      <DialogContent hideCloseButton>
        <DialogHeader>
          <DialogTitle>发现未保存的本地草稿</DialogTitle>
          <DialogDescription>
            上次编辑可能因断网或页面意外关闭而未保存。请选择恢复草稿或使用服务器版本。
          </DialogDescription>
        </DialogHeader>
        {recoveryDraft && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{recoveryDraft.draft.title || "无标题"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              本地修改于 {new Date(recoveryDraft.updatedAt).toLocaleString("zh-CN")}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDiscard}>
            使用服务器版本
          </Button>
          <Button onClick={onRestore}>恢复本地草稿</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
