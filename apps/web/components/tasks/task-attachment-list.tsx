"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, Eye, File, Loader2, Trash2 } from "lucide-react";
import type { TaskAttachment } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatAttachmentSize,
  getAttachmentPreviewKind,
} from "@/lib/tasks/attachments";

interface TaskAttachmentListProps {
  attachments: TaskAttachment[];
  emptyText?: string;
  taskNames?: Record<string, string>;
  onOpenTask?: (taskId: string) => void;
  onDeleted: (attachmentId: string) => void;
}

export function TaskAttachmentList({
  attachments,
  emptyText = "暂无附件",
  taskNames,
  onOpenTask,
  onDeleted,
}: TaskAttachmentListProps) {
  const supabase = useMemo(() => createClient(), []);
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskAttachment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const publicUrl = (attachment: TaskAttachment) =>
    supabase.storage.from(attachment.bucket).getPublicUrl(attachment.path).data.publicUrl;

  const downloadAttachment = async (attachment: TaskAttachment) => {
    setBusyId(attachment.id);
    const { data, error } = await supabase.storage
      .from(attachment.bucket)
      .download(attachment.path);
    setBusyId(null);
    if (error || !data) {
      toast({ title: "下载附件失败", variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const deleteAttachment = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyId(target.id);
    const { error: storageError } = await supabase.storage
      .from(target.bucket)
      .remove([target.path]);
    if (storageError) {
      setBusyId(null);
      toast({ title: "删除附件文件失败", variant: "destructive" });
      return;
    }
    const { error: metadataError } = await supabase
      .from("task_attachments")
      .delete()
      .eq("id", target.id);
    setBusyId(null);
    if (metadataError) {
      toast({ title: "删除附件记录失败", variant: "destructive" });
      return;
    }
    setDeleteTarget(null);
    if (preview?.id === target.id) setPreview(null);
    onDeleted(target.id);
    toast({ title: "附件已删除" });
  };

  if (attachments.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="group flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <File className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="block max-w-full truncate text-left font-medium hover:underline"
                onClick={() => setPreview(attachment)}
              >
                {attachment.name}
              </button>
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {formatAttachmentSize(attachment.size_bytes) && (
                  <span>{formatAttachmentSize(attachment.size_bytes)}</span>
                )}
                {taskNames && (
                  <button
                    type="button"
                    className="truncate hover:text-foreground hover:underline"
                    onClick={() => onOpenTask?.(attachment.task_id)}
                  >
                    {taskNames[attachment.task_id] || "任务已删除或不存在"}
                  </button>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
              <button type="button" aria-label={`预览 ${attachment.name}`} onClick={() => setPreview(attachment)} className="rounded p-1.5 hover:bg-muted">
                <Eye className="h-4 w-4" />
              </button>
              <button type="button" aria-label={`下载 ${attachment.name}`} disabled={busyId === attachment.id} onClick={() => void downloadAttachment(attachment)} className="rounded p-1.5 hover:bg-muted disabled:opacity-50">
                {busyId === attachment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </button>
              <button type="button" aria-label={`删除 ${attachment.name}`} disabled={busyId === attachment.id} onClick={() => setDeleteTarget(attachment)} className="rounded p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-8">{preview.name}</DialogTitle>
                <DialogDescription>{formatAttachmentSize(preview.size_bytes) || "大小未知"}</DialogDescription>
              </DialogHeader>
              <AttachmentPreview attachment={preview} url={publicUrl(preview)} />
              <DialogFooter>
                <a href={publicUrl(preview)} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-muted">
                  <ExternalLink className="h-4 w-4" />
                  新窗口打开
                </a>
                <button type="button" onClick={() => void downloadAttachment(preview)} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm text-primary-foreground">
                  <Download className="h-4 w-4" />
                  下载
                </button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除附件</DialogTitle>
            <DialogDescription>
              将永久删除“{deleteTarget?.name}”及其存储文件，此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setDeleteTarget(null)} className="h-9 rounded-md border px-3 text-sm hover:bg-muted">取消</button>
            <button type="button" disabled={busyId === deleteTarget?.id} onClick={() => void deleteAttachment()} className="h-9 rounded-md bg-destructive px-3 text-sm text-destructive-foreground disabled:opacity-50">确认删除</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AttachmentPreview({ attachment, url }: { attachment: TaskAttachment; url: string }) {
  const kind = getAttachmentPreviewKind(attachment.mime_type, attachment.name);
  if (kind === "image") {
    return <img src={url} alt={attachment.name} className="mx-auto max-h-[65dvh] max-w-full rounded-md object-contain" />;
  }
  if (kind === "audio") return <audio controls src={url} className="w-full" />;
  if (kind === "video") return <video controls src={url} className="max-h-[65dvh] w-full rounded-md bg-black" />;
  if (kind === "pdf" || kind === "text") {
    return <iframe title={`预览 ${attachment.name}`} src={url} sandbox="" className="h-[65dvh] w-full rounded-md border bg-background" />;
  }
  return (
    <div className="grid min-h-48 place-items-center rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
      此文件类型暂不支持在线预览，请下载后查看。
    </div>
  );
}
