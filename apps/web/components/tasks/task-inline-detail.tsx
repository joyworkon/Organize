"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlignLeft,
  Archive,
  Bookmark,
  CalendarDays,
  Check,
  CheckSquare2,
  Circle,
  Copy,
  Flag,
  FileText,
  Link2,
  MoreHorizontal,
  Paperclip,
  Pin,
  Printer,
  Tag,
  Trash2,
  Upload,
  X,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { isOnline } from "@/lib/offline/network";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { isImeComposing } from "@/lib/input/submit-guard";
import { isTaskOverdue } from "@/lib/tasks/workspace";
import { enqueueTaskOp, makeChecklistUpdateOp } from "@/lib/offline/task-queue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TASK_PRIORITY_CONFIG } from "@organize/shared";
import type { Task, TaskActivity, TaskAttachment, TaskChecklist, TaskList, TaskPriority, TaskWithTags, Tag as TagType } from "@organize/shared";
import { cn } from "@/lib/utils";
import { TaskDatePopover, formatTaskDate } from "@/components/tasks/task-date-popover";
import { TaskRemindersEditor } from "@/components/tasks/task-reminders-editor";
import { buildTaskTemplateSnapshot } from "@/lib/tasks/templates";
import { buildTaskNoteContent } from "@/lib/tasks/note-prefill";
import { claimTaskNoteCreation, releaseTaskNoteCreation } from "@/lib/tasks/note-link";
import { TaskHierarchy } from "@/components/tasks/task-hierarchy";
import { TaskDependencies } from "@/components/tasks/task-dependencies";
import { TaskLinkedContent } from "@/components/tasks/task-linked-content";
import { TaskAttachmentList } from "@/components/tasks/task-attachment-list";
import {
  buildTaskAttachmentPath,
  validateTaskAttachment,
} from "@/lib/tasks/attachments";

interface TaskInlineDetailProps {
  task: TaskWithTags;
  lists: TaskList[];
  onUpdate: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  /** 未完成的前置依赖（父页已按当前任务算好）：完成时用于二次确认 */
  blockingPrerequisites?: { id: string; title: string }[];
}

/** 状态切换到 done 前的阻塞确认：非强制拦截，但不应无声绕过依赖关系 */
function confirmBlocking(blocking: { id: string; title: string }[]): boolean {
  if (blocking.length === 0) return true;
  const names = blocking.map((p) => `「${p.title}」`).join("、");
  return window.confirm(`${blocking.length} 个前置任务尚未完成：${names}。仍要标记为完成吗？`);
}

function statusLabel(status: Task["status"]) {
  return status === "done" ? "已完成" : status === "in_progress" ? "进行中" : status === "cancelled" ? "已放弃" : "待办";
}

/** T04：详情次级信息折叠区——默认收起，简单任务首屏只留标题/完成/日期/优先级/描述 */
function DetailSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-4 rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/40"
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        {title}
        {count !== undefined && count > 0 && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{count}</span>}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export function TaskInlineDetail({ task, lists, onUpdate, onDelete, onClose, onOpenTask, blockingPrerequisites = [] }: TaskInlineDetailProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [checklists, setChecklists] = useState<TaskChecklist[]>([]);
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [tags, setTags] = useState<TagType[]>(task.tags || []);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [showActivity, setShowActivity] = useState(false);

  const loadChildren = async () => {
    const [{ data: checklistData }, { data: activityData }, { data: attachmentData }, { data: tagLinks }, { data: tagData }] = await Promise.all([
      supabase.from("task_checklists").select("*").eq("task_id", task.id).order("sort_order", { ascending: true }),
      supabase.from("task_activities").select("*").eq("task_id", task.id).order("created_at", { ascending: false }).limit(30),
      supabase.from("task_attachments").select("*").eq("task_id", task.id).order("created_at", { ascending: false }),
      supabase.from("task_tags").select("tag_id").eq("task_id", task.id),
      supabase.from("tags").select("*").eq("user_id", task.user_id),
    ]);
    setChecklists((checklistData || []) as TaskChecklist[]);
    setActivities((activityData || []) as TaskActivity[]);
    setAttachments((attachmentData || []) as TaskAttachment[]);
    const tagMap = new Map((tagData || []).map((item) => [item.id, item as TagType]));
    setTags((tagLinks || []).map((link) => tagMap.get(link.tag_id)).filter(Boolean) as TagType[]);
  };

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description || "");
    setTags(task.tags || []);
    void loadChildren();
    // task.id 是唯一加载键；supabase 客户端保持稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const saveTitle = async () => {
    setEditingTitle(false);
    const next = title.trim();
    if (next && next !== task.title) await onUpdate(task.id, { title: next });
  };

  const saveDescription = async () => {
    const next = description.trim();
    if (next !== (task.description || "")) await onUpdate(task.id, { description: next || null });
  };

  const editDescription = async () => {
    const next = await showPrompt({ title: "任务描述", defaultValue: description, placeholder: "补充任务描述…" });
    if (next === null) return;
    setDescription(next);
    void onUpdate(task.id, { description: next.trim() || null });
  };

  const toggleChecklist = async (item: TaskChecklist) => {
    // X1：先乐观更新；离线（或网络异常）直接入队，联网后由任务工作台回放
    const nextCompleted = !item.is_completed;
    setChecklists((current) => current.map((row) => row.id === item.id ? { ...row, is_completed: nextCompleted } : row));
    const offlineUpdate = () => {
      enqueueTaskOp(localStorage, task.user_id, makeChecklistUpdateOp(item.id, { is_completed: nextCompleted }));
      toast({ title: "已离线保存，联网后自动同步" });
    };
    if (!isOnline()) {
      offlineUpdate();
      return;
    }
    const { error } = await supabase.from("task_checklists").update({ is_completed: nextCompleted }).eq("id", item.id);
    if (error) {
      if (isNetworkSaveError(error)) {
        offlineUpdate();
        return;
      }
      setChecklists((current) => current.map((row) => row.id === item.id ? { ...row, is_completed: item.is_completed } : row));
      toast({ title: "更新子任务失败", variant: "destructive" });
    }
  };

  const addTag = async () => {
    const name = (await showPrompt({ title: "添加标签", placeholder: "标签名称" }))?.trim();
    if (!name) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data: tagData, error: tagError } = await supabase.from("tags").upsert({ user_id: userData.user.id, name, color: "blue" }, { onConflict: "user_id,name" }).select().single();
    if (tagError || !tagData) { toast({ title: "标签保存失败", variant: "destructive" }); return; }
    const { error } = await supabase.from("task_tags").upsert({ task_id: task.id, tag_id: tagData.id }, { onConflict: "task_id,tag_id" });
    if (error) toast({ title: "标签关联失败", variant: "destructive" });
    else await loadChildren();
  };

  const duplicate = async () => {
    const { error } = await supabase.from("tasks").insert({
      user_id: task.user_id,
      title: `${task.title} 副本`,
      description: task.description,
      status: "todo",
      priority: task.priority,
      category: task.category,
      list_id: task.list_id || null,
      is_pinned: false,
      sort_order: 0,
      schedule_start_at: task.schedule_start_at || task.due_date || null,
      schedule_end_at: task.schedule_end_at || null,
      all_day: task.all_day || false,
      timezone: task.timezone || null,
      recurrence_rule: null,
      reading_item_id: task.reading_item_id,
      note_id: null,
    });
    if (error) toast({ title: "创建副本失败", variant: "destructive" });
    else {
      toast({ title: "副本已创建" });
      // 通知任务页重新拉取：否则副本要等下一次无关刷新才可见
      window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
    }
  };

  const saveTemplate = async () => {
    const { error } = await supabase.from("task_templates").insert({
      user_id: task.user_id,
      name: task.title,
      template: buildTaskTemplateSnapshot(task),
    });
    toast(error ? { title: "保存模板失败", variant: "destructive" } : { title: "已保存为模板" });
  };

  const openNote = async () => {
    if (task.note_id) { router.push(`/notes/${task.note_id}`); return; }
    // 创建在途时忽略重复点击：双击/连点会各自 insert 一条笔记，后写覆盖关联，前者成孤儿
    if (!claimTaskNoteCreation(task.id)) return;
    try {
      // 便签预填任务描述与子任务清单，避免从空白页开始誊抄
      const { data: note, error } = await supabase.from("notes").insert({ user_id: task.user_id, title: `${task.title} - 便签`, content: buildTaskNoteContent(task, checklists) }).select().single();
      if (error || !note) toast({ title: "创建便签失败", variant: "destructive" });
      else { await onUpdate(task.id, { note_id: note.id }); router.push(`/notes/${note.id}`); }
    } finally {
      releaseTaskNoteCreation(task.id);
    }
  };

  const uploadAttachment = async (file: File) => {
    const validationError = validateTaskAttachment(file);
    if (validationError) {
      toast({ title: validationError, variant: "destructive" });
      return;
    }
    const path = buildTaskAttachmentPath(task.user_id, task.id, file.name);
    const { error: uploadError } = await supabase.storage.from("attachments").upload(path, file);
    if (uploadError) { toast({ title: "上传附件失败", variant: "destructive" }); return; }
    const { error: metaError } = await supabase.from("task_attachments").insert({ user_id: task.user_id, task_id: task.id, name: file.name, bucket: "attachments", path, mime_type: file.type, size_bytes: file.size });
    if (metaError) {
      const storage = supabase.storage.from("attachments") as { remove?: (paths: string[]) => Promise<unknown> };
      if (storage.remove) await storage.remove([path]);
      toast({ title: "附件记录失败，已清理上传对象", variant: "destructive" });
      return;
    }
    toast({ title: "附件已上传" });
    await loadChildren();
  };

  const dateValue = {
    schedule_start_at: task.schedule_start_at || task.due_date,
    schedule_end_at: task.schedule_end_at || null,
    all_day: Boolean(task.all_day),
    timezone: task.timezone || null,
    recurrence_rule: task.recurrence_rule || null,
  };

  return (
    <aside className="organize-task-detail flex min-w-0 flex-1 flex-col bg-background lg:w-[34.5vw] lg:min-w-[420px] lg:max-w-[640px] lg:flex-none">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-5">
        <button type="button" aria-label={task.status === "done" ? "标记未完成" : "标记完成"} onClick={() => {
          const toDone = task.status !== "done";
          if (toDone && !confirmBlocking(blockingPrerequisites)) return;
          void onUpdate(task.id, { status: toDone ? "done" : "todo", completed_at: toDone ? new Date().toISOString() : null });
        }} className={cn("grid h-6 w-6 place-items-center rounded-md border", task.status === "done" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30 hover:border-primary")}>
          {task.status === "done" && <Check className="h-4 w-4" />}
        </button>
        <span className="h-6 w-px bg-border" />
        <TaskDatePopover
          value={dateValue}
          overdue={isTaskOverdue(task)}
          onChange={(value) => onUpdate(task.id, { schedule_start_at: value.schedule_start_at, schedule_end_at: value.schedule_end_at, due_date: value.schedule_end_at || value.schedule_start_at, all_day: value.all_day, timezone: value.timezone, recurrence_rule: value.recurrence_rule })}
          trigger={<button type="button" className={cn("inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent", isTaskOverdue(task) ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30" : "text-muted-foreground hover:text-foreground")}><CalendarDays className="h-4 w-4" />{formatTaskDate(dateValue.schedule_start_at)}</button>}
          align="start"
        />
        <Select value={task.priority} onValueChange={(value: TaskPriority) => void onUpdate(task.id, { priority: value })}>
          <SelectTrigger aria-label="优先级" className="h-8 w-auto min-w-[72px] gap-1 border-0 px-2 text-sm shadow-none hover:bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TASK_PRIORITY_CONFIG).map(([key, config]) => (
              <SelectItem key={key} value={key}>
                <span className="flex items-center gap-2"><Flag className={cn("h-3.5 w-3.5", config.color)} />{config.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button type="button" aria-label="标记重要" onClick={() => void onUpdate(task.id, { is_pinned: !task.is_pinned })} className={cn("ml-auto rounded-md p-2 hover:bg-muted", task.is_pinned && "text-primary")}><Flag className="h-5 w-5" /></button>
        <button type="button" aria-label="关闭任务详情" onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><X className="h-5 w-5" /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <div className="flex items-start gap-3">
          {editingTitle ? (
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={(event) => { if (isImeComposing(event)) return; if (event.key === "Enter") void saveTitle(); if (event.key === "Escape") { setTitle(task.title); setEditingTitle(false); } }} className="min-w-0 flex-1 border-b bg-transparent text-2xl font-semibold outline-none" />
          ) : (
            <h1 className="min-w-0 flex-1 cursor-text text-2xl font-semibold leading-tight" onClick={() => setEditingTitle(true)}>{task.title}</h1>
          )}
        </div>
        <button type="button" className="mt-5 text-sm text-muted-foreground hover:text-foreground" onClick={() => void editDescription()}><span className={cn(description ? "text-foreground" : "text-muted-foreground")}>{description || "描述"}</span></button>

        <div className="mt-8">
          <TaskLinkedContent task={task} />
        </div>

        <div className="mt-8">
          <TaskHierarchy task={task} onOpenTask={onOpenTask} />
        </div>

        {/* T04：依赖、清单、提醒、附件收进折叠区——有内容才显示计数，简单任务首屏干净 */}
        <div className="mt-4 space-y-2">
          <DetailSection title="依赖关系">
            <TaskDependencies task={task} onOpenTask={onOpenTask} />
          </DetailSection>

          {checklists.length > 0 && (
            <DetailSection title="清单项" count={checklists.length}>
              {checklists.map((item) => (
                <button type="button" key={item.id} onClick={() => void toggleChecklist(item)} className="group flex w-full items-center gap-3 border-b py-3 text-left text-sm hover:bg-muted/40">
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", item.is_completed ? "border-muted bg-muted text-muted-foreground" : "border-muted-foreground/30")}>{item.is_completed && <Check className="h-3.5 w-3.5" />}</span>
                  <span className={cn("min-w-0 flex-1", item.is_completed && "text-muted-foreground line-through")}>{item.content}</span>
                </button>
              ))}
            </DetailSection>
          )}

          <DetailSection title="提醒">
            <TaskRemindersEditor task={task} />
          </DetailSection>

          <DetailSection title="附件" count={attachments.length}>
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs text-muted-foreground">随任务保存的文件</span>
              <button type="button" onClick={() => uploadRef.current?.click()} className="text-xs text-primary hover:underline">上传</button>
            </div>
            <TaskAttachmentList
              attachments={attachments}
              onDeleted={(attachmentId) =>
                setAttachments((items) => items.filter((item) => item.id !== attachmentId))
              }
            />
          </DetailSection>
        </div>

        {showActivity && (
          <section className="mt-8 rounded-lg bg-muted/30 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4" />任务动态</h2>
            {activities.length === 0 ? <p className="text-xs text-muted-foreground">暂无动态</p> : activities.map((activity) => <div key={activity.id} className="flex items-center gap-2 py-1 text-xs text-muted-foreground"><Circle className="h-2 w-2 fill-current" />{activity.action}<span className="ml-auto">{new Date(activity.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric" })}</span></div>)}
          </section>
        )}

        {tags.length > 0 && <div className="mt-6 flex flex-wrap gap-1.5">{tags.map((item) => <span key={item.id} className="rounded-full bg-muted px-2 py-1 text-xs">#{item.name}</span>)}</div>}
      </div>

      <footer className="flex min-h-16 shrink-0 items-center gap-2 border-t px-5">
        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><span>{lists.find((item) => item.id === task.list_id)?.icon || "📋"}</span><span className="truncate">{lists.find((item) => item.id === task.list_id)?.name || "未分类"}</span></span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="编辑任务描述" onClick={() => void editDescription()} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><AlignLeft className="h-5 w-5" /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" aria-label="更多任务操作" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56">
              <DropdownMenuItem onClick={() => document.getElementById(`subtask-input-${task.id}`)?.focus()}><CheckSquare2 className="mr-2 h-4 w-4" />添加子任务</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void onUpdate(task.id, { is_pinned: !task.is_pinned })}><Pin className="mr-2 h-4 w-4" />{task.is_pinned ? "取消置顶" : "置顶"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void onUpdate(task.id, { status: "cancelled" })}><Archive className="mr-2 h-4 w-4" />放弃</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void addTag()}><Tag className="mr-2 h-4 w-4" />标签</DropdownMenuItem>
              <DropdownMenuItem onClick={() => uploadRef.current?.click()}><Upload className="mr-2 h-4 w-4" />上传附件</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowActivity((current) => !current)}><Activity className="mr-2 h-4 w-4" />任务动态</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void saveTemplate()}><Bookmark className="mr-2 h-4 w-4" />保存为模板</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void duplicate()}><Copy className="mr-2 h-4 w-4" />创建副本</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/tasks/${task.id}`).then(() => toast({ title: "任务链接已复制" }))}><Link2 className="mr-2 h-4 w-4" />复制链接</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void openNote()}><FileText className="mr-2 h-4 w-4" />打开便签</DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />打印</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void onDelete(task.id)}><Trash2 className="mr-2 h-4 w-4" />删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
        <input ref={uploadRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file); event.currentTarget.value = ""; }} />
      </footer>
    </aside>
  );
}
