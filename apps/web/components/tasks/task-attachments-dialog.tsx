"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import type { TaskAttachment, TaskWithTags } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TaskAttachmentList } from "@/components/tasks/task-attachment-list";

interface TaskAttachmentsDialogProps {
  tasks: TaskWithTags[];
  onOpenTask: (taskId: string) => void;
}

export function TaskAttachmentsDialog({
  tasks,
  onOpenTask,
}: TaskAttachmentsDialogProps) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("task_attachments")
        .select("*")
        .order("created_at", { ascending: false });
      setLoading(false);
      if (error) {
        toast({ title: "读取附件失败", variant: "destructive" });
        return;
      }
      setAttachments((data || []) as TaskAttachment[]);
    };
    void load();
  }, [open, supabase]);

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
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted">
          <Paperclip className="h-4 w-4" />
          附件
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
        ) : (
          <TaskAttachmentList
            attachments={filtered}
            emptyText={query ? "没有匹配的附件" : "暂无任务附件"}
            taskNames={taskNames}
            onOpenTask={(taskId) => {
              setOpen(false);
              onOpenTask(taskId);
            }}
            onDeleted={(attachmentId) =>
              setAttachments((items) => items.filter((item) => item.id !== attachmentId))
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
