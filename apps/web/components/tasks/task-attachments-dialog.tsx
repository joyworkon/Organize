"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip } from "@/components/icons";
import type { TaskAttachment, TaskWithTags } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { isOnline } from "@/lib/offline/network";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TaskAttachmentList } from "@/components/tasks/task-attachment-list";
import {
  TASK_ATTACHMENTS_LIST_LOAD_ERROR_MESSAGE,
  nextAttachmentsAfterLoad,
} from "@/lib/tasks/attachments-list-load";

interface TaskAttachmentsDialogProps {
  tasks: TaskWithTags[];
  onOpenTask: (taskId: string) => void;
  /** 清单栏收窄（打开任务详情的双栏态）时只渲染图标，文字进 aria-label/title */
  compact?: boolean;
}

export function TaskAttachmentsDialog({
  tasks,
  onOpenTask,
  compact = false,
}: TaskAttachmentsDialogProps) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  /** 附件列表加载失败（在线时）：没有已加载的列表时显示错误 + 重试，而不是「暂无任务附件」 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 上次成功快照：刷新失败时原样保留（load 的闭包读不到最新 state） */
  const attachmentsRef = useRef<TaskAttachment[]>([]);
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("task_attachments")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    // 失败保留上次成功快照 + 错误态与重试，不得伪装成「暂无任务附件」
    const plan = nextAttachmentsAfterLoad({
      previous: attachmentsRef.current,
      data: data ?? null,
      error,
    });
    attachmentsRef.current = plan.attachments;
    setAttachments(plan.attachments);
    setLoadError(plan.loadError);
    // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
    if (plan.loadError && isOnline()) {
      toast({ title: TASK_ATTACHMENTS_LIST_LOAD_ERROR_MESSAGE, variant: "destructive" });
    }
  };

  const retryLoad = () => {
    setLoadError(null);
    void load();
  };

  useEffect(() => {
    if (open) void load();
    // 每次打开时刷新；supabase 客户端按 useMemo 稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const taskNames = useMemo(
    () => Object.fromEntries(tasks.map((task) => [task.id, task.title])),
    [tasks]
  );
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const filtered = normalized
    ? attachments.filter((attachment) =>
        `${attachment.name} ${taskNames[attachment.task_id] || ""}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalized)
      )
    : attachments;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="任务附件"
          title="任务附件"
          className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-md border text-sm hover:bg-muted", compact ? "px-2.5" : "px-3")}
        >
          <Paperclip className="h-4 w-4" />
          {!compact && "附件"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>任务附件</DialogTitle>
          <DialogDescription>集中预览、下载和删除全部任务附件。</DialogDescription>
        </DialogHeader>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索文件名或任务"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        />
        {loading ? (
          <div className="grid min-h-40 place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : loadError && attachments.length === 0 ? (
          /* 加载失败不得伪装成「暂无任务附件」：无快照给错误空态 + 重试 */
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed py-10 text-muted-foreground" role="alert">
            <Paperclip className="h-7 w-7" />
            <p className="text-sm text-destructive">{loadError}</p>
            <Button size="sm" variant="outline" onClick={retryLoad}>重试</Button>
          </div>
        ) : (
          <>
            {/* 刷新失败但已有列表：保留列表 + 持久行内提示 + 就地重试（toast 会消失） */}
            {loadError && (
              <div
                className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2"
                role="alert"
              >
                <span className="text-xs text-destructive">{loadError}</span>
                <Button size="sm" variant="outline" onClick={retryLoad}>重试</Button>
              </div>
            )}
            <TaskAttachmentList
              attachments={filtered}
              emptyText={query ? "没有匹配的附件" : "暂无任务附件"}
              taskNames={taskNames}
              onOpenTask={(taskId) => {
                setOpen(false);
                onOpenTask(taskId);
              }}
              onDeleted={(attachmentId) => {
                setAttachments((items) => items.filter((item) => item.id !== attachmentId));
                attachmentsRef.current = attachmentsRef.current.filter(
                  (item) => item.id !== attachmentId
                );
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
