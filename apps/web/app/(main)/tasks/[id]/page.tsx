"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CompleteTaskDialog } from "@/components/tasks/complete-task-dialog";
import { TaskDatePicker } from "@/components/tasks/task-date-picker";
import {
  ArrowLeft,
  Loader2,
  Pin,
  Trash2,
  CheckCircle2,
  BookOpen,
  FileText,
  Plus,
  X,
  CheckSquare,
  Clock,
  Calendar,
  Share2,
  MoreHorizontal,
  Copy,
  Bookmark,
  Printer,
  Upload,
  Paperclip,
  Activity,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type {
  Task,
  TaskChecklist,
  TaskStatus,
  TaskPriority,
  TaskCategory,
  Tag,
} from "@organize/shared";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  TASK_CATEGORY_CONFIG,
} from "@organize/shared";
import { FavoriteButton } from "@/components/favorite-button";
import { TagBadge } from "@/components/tags/tag-badge";
import { mutateTrash } from "@/lib/trash/client";

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [task, setTask] = useState<Task | null>(null);
  const [checklists, setChecklists] = useState<TaskChecklist[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [attachments, setAttachments] = useState<import("@organize/shared").TaskAttachment[]>([]);
  const [activities, setActivities] = useState<import("@organize/shared").TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState("");
  const [newChecklistContent, setNewChecklistContent] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);

  useEffect(() => {
    loadTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadTask 非 memoized，加入会触发重渲染循环；按 taskId 变化加载
  }, [taskId, supabase]);

  async function loadTask() {
    setLoading(true);
    setError(null);
    try {
      const { data: taskData, error: taskError } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .single();

      if (taskError) throw taskError;
      if (!taskData) {
        setError("任务不存在");
        return;
      }

      const loadedTask = taskData as Task;
      setTask(loadedTask);
      setEditedTitle(loadedTask.title);
      setEditedDescription(loadedTask.description || "");

      const [{ data: checklistData }, { data: tagLinks }, { data: tagsData }, { data: attData }, { data: actData }] = await Promise.all([
        supabase
          .from("task_checklists")
          .select("*")
          .eq("task_id", taskId)
          .order("sort_order", { ascending: true }),
        supabase.from("task_tags").select("tag_id").eq("task_id", taskId),
        supabase.from("tags").select("*"),
        supabase.from("task_attachments").select("*").eq("task_id", taskId).order("created_at", { ascending: false }),
        supabase.from("task_activities").select("*").eq("task_id", taskId).order("created_at", { ascending: false }).limit(20),
      ]);

      setChecklists((checklistData as TaskChecklist[]) || []);

      const tagMap = new Map((tagsData as Tag[] || []).map(t => [t.id, t]));
      const taskTags: Tag[] = [];
      for (const link of (tagLinks || [])) {
        const tag = tagMap.get(link.tag_id);
        if (tag) taskTags.push(tag);
      }
      setTags(taskTags);
      setAttachments((attData as import("@organize/shared").TaskAttachment[]) || []);
      setActivities((actData as import("@organize/shared").TaskActivity[]) || []);
    } catch (err) {
      console.error("加载任务失败:", err);
      setError("加载任务失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveTask(updates: Partial<Task>) {
    if (!task) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", task.id);
      if (error) throw error;
      setTask(prev => prev ? { ...prev, ...updates } : null);
      toast({ title: "已保存" });
    } catch (err) {
      console.error("保存失败:", err);
      toast({ title: "保存失败", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleChecklist(checklistId: string, isCompleted: boolean) {
    try {
      const { error } = await supabase
        .from("task_checklists")
        .update({ is_completed: isCompleted })
        .eq("id", checklistId);
      if (error) throw error;
      setChecklists(prev => prev.map(c => c.id === checklistId ? { ...c, is_completed: isCompleted } : c));
    } catch (err) {
      console.error("更新子任务失败:", err);
      toast({ title: "更新失败", variant: "destructive" });
    }
  }

  async function addChecklist() {
    if (!task || !newChecklistContent.trim()) return;
    const content = newChecklistContent.trim();
    setNewChecklistContent("");
    try {
      const maxOrder = checklists.reduce((max, c) => Math.max(max, c.sort_order), -1);
      const { data, error } = await supabase
        .from("task_checklists")
        .insert({
          task_id: task.id,
          content,
          is_completed: false,
          sort_order: maxOrder + 1,
        })
        .select()
        .single();
      if (error) throw error;
      setChecklists(prev => [...prev, data as TaskChecklist]);
    } catch (err) {
      console.error("添加子任务失败:", err);
      toast({ title: "添加失败", variant: "destructive" });
    }
  }

  async function deleteChecklist(checklistId: string) {
    try {
      const { error } = await supabase
        .from("task_checklists")
        .delete()
        .eq("id", checklistId);
      if (error) throw error;
      setChecklists(prev => prev.filter(c => c.id !== checklistId));
    } catch (err) {
      console.error("删除子任务失败:", err);
      toast({ title: "删除失败", variant: "destructive" });
    }
  }

  async function togglePin() {
    if (!task) return;
    await saveTask({ is_pinned: !task.is_pinned });
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "任务链接已复制" });
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
  }

  /** 创建副本：todo/未置顶/清单项重置 */
  async function handleDuplicate() {
    if (!task) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("tasks").insert({
      user_id: user.id,
      title: `${task.title} 副本`,
      description: task.description,
      status: "todo",
      priority: task.priority,
      category: task.category,
      list_id: task.list_id ?? null,
      is_pinned: false,
      sort_order: 0,
    }).select("id").single();
    if (error || !data) { toast({ title: "创建副本失败", variant: "destructive" }); return; }
    toast({ title: "副本已创建" });
    router.push(`/tasks/${data.id}`);
  }

  /** 打开便签：复用 note_id；无则建笔记 */
  async function handleOpenNote() {
    if (!task) return;
    if (task.note_id) { router.push(`/notes/${task.note_id}`); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: note, error } = await supabase.from("notes").insert({
      user_id: user.id,
      title: `${task.title} - 便签`,
      content: { type: "doc", content: [{ type: "paragraph" }] },
    }).select("id").single();
    if (error || !note) { toast({ title: "创建便签失败", variant: "destructive" }); return; }
    await supabase.from("tasks").update({ note_id: note.id }).eq("id", task.id);
    router.push(`/notes/${note.id}`);
  }

  /** 保存为模板 */
  async function handleSaveTemplate() {
    if (!task) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("task_templates").insert({
      user_id: user.id,
      name: task.title,
      template: {
        title: task.title, description: task.description, priority: task.priority,
        category: task.category, estimated_minutes: task.estimated_minutes,
      },
    });
    if (error) { toast({ title: "保存模板失败", variant: "destructive" }); return; }
    toast({ title: "模板已保存" });
  }

  async function handleDelete() {
    if (!task) return;
    try {
      await mutateTrash("task", [task.id], "soft_delete");
      toast({ title: "任务已移入垃圾箱" });
      router.push("/tasks");
    } catch (err) {
      console.error("删除任务失败:", err);
      toast({ title: "删除失败", variant: "destructive" });
    } finally {
      setDeleteDialogOpen(false);
    }
  }

  async function handleStatusChange(status: TaskStatus) {
    const updates: Partial<Task> = { status };
    if (status === "done") {
      updates.completed_at = new Date().toISOString();
    } else {
      updates.completed_at = null;
    }
    await saveTask(updates);
  }

  async function handleComplete(reflectionData?: { title?: string; content?: string; lessonType?: string }) {
    if (!task) return;
    await handleStatusChange("done");

    if (reflectionData && reflectionData.content?.trim()) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("lessons").insert({
          user_id: user.id,
          title: reflectionData.title?.trim() || `${task.title} - 复盘`,
          content: reflectionData.content.trim() ? {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: reflectionData.content.trim() }] },
            ],
          } : null,
          lesson_type: reflectionData.lessonType || "reflection",
          task_id: task.id,
        });
      }
    }

    setCompleteDialogOpen(false);
  }

  function handleTitleSave() {
    setIsEditingTitle(false);
    if (task && editedTitle.trim() && editedTitle !== task.title) {
      saveTask({ title: editedTitle.trim() });
    } else if (task) {
      setEditedTitle(task.title);
    }
  }

  function handleDescriptionSave() {
    setIsEditingDescription(false);
    if (task) {
      const newDesc = editedDescription.trim() || null;
      if (newDesc !== task.description) {
        saveTask({ description: newDesc });
      }
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const checklistCompleted = checklists.filter(c => c.is_completed).length;
  const checklistTotal = checklists.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        {error || "任务不存在或已被删除"}
        <br />
        <Link href="/tasks" className="text-primary underline text-sm mt-2 inline-block">
          返回任务列表
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/tasks">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              返回
            </Button>
          </Link>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">首页</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/tasks">待办</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="max-w-[200px]">{task.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-2">
          <FavoriteButton targetType="task" targetId={taskId} />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyLink}
            title="复制链接"
          >
            <Share2 className="h-4 w-4" />
          </Button>
          {/* 更多操作菜单 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" title="更多操作">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={handleDuplicate}>
                <Copy className="h-4 w-4 mr-2" />创建副本
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenNote}>
                <FileText className="h-4 w-4 mr-2" />打开便签
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSaveTemplate}>
                <Bookmark className="h-4 w-4 mr-2" />保存为模板
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-2" />打印详情
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            onClick={togglePin}
            disabled={saving}
            title={task.is_pinned ? "取消置顶" : "置顶"}
            aria-label={task.is_pinned ? "取消置顶" : "置顶"}
          >
            <Pin className={cn("h-4 w-4", task.is_pinned && "fill-primary text-primary")} />
          </Button>
          {task.status !== "done" && (
            <Button
              size="sm"
              onClick={() => setCompleteDialogOpen(true)}
              className="gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              完成任务
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
            className="text-destructive hover:text-destructive"
            title="移入垃圾箱"
            aria-label="移入垃圾箱"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-6">
          <div>
            {isEditingTitle ? (
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTitleSave();
                  if (e.key === "Escape") {
                    setIsEditingTitle(false);
                    setEditedTitle(task.title);
                  }
                }}
                autoFocus
                className="text-2xl font-bold"
              />
            ) : (
              <h1
                className="text-2xl font-bold cursor-text hover:bg-accent/50 -mx-2 px-2 py-1 rounded-md transition-colors"
                onClick={() => setIsEditingTitle(true)}
              >
                {task.title}
              </h1>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={task.status} onValueChange={(v: TaskStatus) => handleStatusChange(v)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TASK_STATUS_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={task.priority} onValueChange={(v: TaskPriority) => saveTask({ priority: v })}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TASK_PRIORITY_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={task.category} onValueChange={(v: TaskCategory) => saveTask({ category: v })}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TASK_CATEGORY_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 日期组件（可展开设置日程/全天/重复） */}
          <details className="group">
            <summary className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer list-none">
              <Calendar className="h-4 w-4" />
              <span>
                {task.schedule_start_at || task.due_date
                  ? `截止: ${formatDate(task.schedule_start_at || task.due_date || "")}`
                  : "设置日期"}
              </span>
              {task.recurrence_rule && (
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                  {task.recurrence_rule.frequency === "daily" ? "每天" : task.recurrence_rule.frequency === "weekly" ? "每周" : task.recurrence_rule.frequency === "monthly" ? "每月" : "每年"}
                </span>
              )}
            </summary>
            <div className="mt-2 p-3 border rounded-lg bg-muted/30">
              <TaskDatePicker
                value={{
                  schedule_start_at: task.schedule_start_at || task.due_date,
                  schedule_end_at: task.schedule_end_at ?? null,
                  all_day: task.all_day ?? false,
                  timezone: task.timezone ?? null,
                  recurrence_rule: task.recurrence_rule ?? null,
                }}
                onChange={async (v) => {
                  const { error } = await supabase.from("tasks").update({
                    schedule_start_at: v.schedule_start_at,
                    schedule_end_at: v.schedule_end_at,
                    all_day: v.all_day,
                    timezone: v.timezone,
                    recurrence_rule: v.recurrence_rule as any,
                  }).eq("id", task.id);
                  if (error) { toast({ title: "保存日期失败", variant: "destructive" }); return; }
                  loadTask(); // 刷新
                }}
              />
            </div>
          </details>

          {(task.estimated_minutes || task.actual_minutes) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                预计: {task.estimated_minutes}分
                {task.actual_minutes ? ` / 实际: ${task.actual_minutes}分` : ""}
              </span>
            </div>
          )}

          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">描述</h3>
            {isEditingDescription ? (
              <Textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onBlur={handleDescriptionSave}
                placeholder="添加任务描述..."
                autoFocus
                rows={3}
              />
            ) : (
              <p
                className="text-sm cursor-text hover:bg-accent/50 -mx-2 px-2 py-1 rounded-md transition-colors min-h-[2.5rem]"
                onClick={() => setIsEditingDescription(true)}
              >
                {task.description || <span className="text-muted-foreground">点击添加描述...</span>}
              </p>
            )}
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <TagBadge key={tag.id} tag={tag} />
              ))}
            </div>
          )}

          {(task.reading_item_id || task.note_id) && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">关联内容</h3>
              <div className="flex flex-wrap gap-2">
                {task.reading_item_id && (
                  <Link
                    href={`/library/${task.reading_item_id}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <BookOpen className="h-4 w-4" />
                    关联阅读
                  </Link>
                )}
                {task.note_id && (
                  <Link
                    href={`/notes/${task.note_id}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    关联笔记
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* 附件区域（12项菜单之上传附件） */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">附件</h3>
              <label className="cursor-pointer text-sm text-primary hover:underline flex items-center gap-1">
                <Upload className="h-3.5 w-3.5" />上传
                <input
                  type="file"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file || !task) return;
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    const path = `${user.id}/tasks/${task.id}/${Date.now()}-${file.name}`;
                    const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
                    if (upErr) {
                      toast({ title: "上传失败", variant: "destructive" });
                      return;
                    }
                    const { error: metaErr } = await supabase.from("task_attachments").insert({
                      user_id: user.id, task_id: task.id, name: file.name,
                      bucket: "attachments", path, mime_type: file.type, size_bytes: file.size,
                    });
                    if (metaErr) {
                      // 元数据写失败 → 补偿删除已上传对象（任务书红线）
                      await supabase.storage.from("attachments").remove([path]);
                      toast({ title: "附件记录失败，已清理", variant: "destructive" });
                      return;
                    }
                    toast({ title: "附件已上传" });
                    loadTask();
                  }}
                />
              </label>
            </div>
            {attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">无附件</p>
            ) : (
              <div className="space-y-1">
                {attachments.map((att) => (
                  <div key={att.id} className="flex items-center gap-2 text-sm group">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a
                      href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${att.bucket}/${att.path}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex-1 truncate hover:underline"
                    >{att.name}</a>
                    <span className="text-xs text-muted-foreground">{att.size_bytes ? `${Math.round(att.size_bytes / 1024)}KB` : ""}</span>
                    <button
                      onClick={async () => {
                        await supabase.storage.from(att.bucket).remove([att.path]);
                        await supabase.from("task_attachments").delete().eq("id", att.id);
                        loadTask();
                        toast({ title: "附件已删除" });
                      }}
                      className="opacity-0 group-hover:opacity-100 text-destructive"
                    ><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 任务动态（12项菜单之任务动态） */}
          {activities.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">动态</h3>
              <div className="space-y-1.5">
                {activities.map((act) => (
                  <div key={act.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Activity className="h-3 w-3 shrink-0" />
                    <span>
                      {act.action === "created" ? "创建任务" :
                       act.action === "status_changed" ? `状态变更：${(act.detail as any)?.from} → ${(act.detail as any)?.to}` :
                       act.action}
                    </span>
                    <span className="ml-auto">{new Date(act.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckSquare className="h-4 w-4" />
            子任务
            {checklistTotal > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({checklistCompleted}/{checklistTotal})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {checklists.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">暂无子任务</p>
          )}
          {checklists.map((item) => (
            <div
              key={item.id}
              className="group flex items-start gap-3 p-2 rounded-md hover:bg-accent/50 transition-colors"
            >
              <Checkbox
                checked={item.is_completed}
                onCheckedChange={(checked) => toggleChecklist(item.id, checked as boolean)}
                className="mt-0.5"
              />
              <span
                className={cn(
                  "flex-1 text-sm",
                  item.is_completed && "line-through text-muted-foreground"
                )}
              >
                {item.content}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                onClick={() => deleteChecklist(item.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2">
            <Input
              placeholder="添加子任务..."
              value={newChecklistContent}
              onChange={(e) => setNewChecklistContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addChecklist();
              }}
            />
            <Button size="sm" onClick={addChecklist} disabled={!newChecklistContent.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground space-y-1">
        <div>创建于: {formatDate(task.created_at)}</div>
        <div>更新于: {formatDate(task.updated_at)}</div>
        {task.completed_at && <div>完成于: {formatDate(task.completed_at)}</div>}
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              将任务「{task.title}」移入垃圾箱？任务清单和标签会保留，之后可以恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              移入垃圾箱
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CompleteTaskDialog
        open={completeDialogOpen}
        task={task}
        onClose={() => setCompleteDialogOpen(false)}
        onComplete={handleComplete}
      />
    </div>
  );
}
