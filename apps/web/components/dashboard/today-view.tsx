"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { generateNextRecurringTask } from "@/lib/tasks/recurring";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/hooks/use-toast";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { cn } from "@/lib/utils";
import type { Task, TaskWithTags, ReadingItem, NoteWithTags, Tag } from "@organize/shared";
import { TASK_CATEGORY_CONFIG } from "@organize/shared";
import { computeTaskStreak, computeTodayCompletion } from "@/lib/dashboard/workbench-stats";
import { applyTaskUpdate } from "@/lib/tasks/atomic-update";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import {
  FileText,
  Link as LinkIcon,
  AlertCircle,
  CalendarClock,
  PlayCircle,
  BookOpen,
  FileText as NoteIcon,
  Flame,
  CheckCircle2,
  Clock,
  RefreshCw,
  Loader2,
  ListChecks,
  ChevronDown,
} from "lucide-react";
import { TaskNavigationMenu } from "@/components/tasks/task-navigation-menu";

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const weekDay = weekDays[date.getDay()];
  return `${year}年${month}月${day}日 ${weekDay}`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "凌晨好";
  if (hour < 12) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function isOverdue(dateStr: string | null, status: string): boolean {
  if (!dateStr) return false;
  if (status === "done" || status === "cancelled") return false;
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date < today;
}

function formatDueTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (isToday(dateStr)) {
    if (hours < 0) return "已过期";
    if (hours === 0) return "今天到期";
    return `今天 ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  }
  if (days === -1) return "昨天到期";
  if (days < -1) return `${Math.abs(days)}天前到期`;
  if (days === 1) return "明天到期";
  if (days < 7) return `${days}天后到期`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getNoteExcerpt(content: Record<string, unknown> | null): string {
  if (!content) return "";
  try {
    const contentArr = (content as { content?: Array<{ content?: Array<{ text?: string }> }> }).content;
    if (contentArr && contentArr.length > 0) {
      const firstPara = contentArr[0];
      if (firstPara.content && firstPara.content.length > 0) {
        const text = firstPara.content.map((c) => c.text || "").join("");
        return text.length > 60 ? text.slice(0, 60) + "..." : text;
      }
    }
  } catch {
    // ignore
  }
  return "";
}

export default function TodayView() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [overdueTasks, setOverdueTasks] = useState<TaskWithTags[]>([]);
  const [todayTasks, setTodayTasks] = useState<TaskWithTags[]>([]);
  const [inProgressTasks, setInProgressTasks] = useState<TaskWithTags[]>([]);
  const [unreadArticles, setUnreadArticles] = useState<ReadingItem[]>([]);
  const [recentNotes, setRecentNotes] = useState<NoteWithTags[]>([]);
  // 全量任务驻留内存：完成率与连续天数都由它即时计算（纯函数，见 lib/dashboard/workbench-stats）
  const [allTasks, setAllTasks] = useState<TaskWithTags[]>([]);

  const today = new Date();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      const results = await Promise.allSettled([
        supabase.from("tasks").select("*").eq("user_id", user.id),
        supabase.from("reading_items")
          .select("*")
          .eq("user_id", user.id)
          .eq("reading_status", "unread")
          .order("is_pinned", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5),
        supabase.from("notes")
          .select("*, reading_item:reading_items(id, title, url)")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(5),
      ]);

      if (results[0].status === "fulfilled") {
        const { data: tasksData } = results[0].value;
        const tasksList = (tasksData || []) as Task[];

        const { data: tagLinks } = await supabase.from("task_tags").select("task_id, tag_id");
        const { data: tagsData } = await supabase.from("tags").select("id, name").eq("user_id", user.id);
        const tagMap = new Map((tagsData || []).map((t) => [t.id, t as Tag]));
        const linksByTask = new Map<string, Tag[]>();
        for (const link of tagLinks || []) {
          const tag = tagMap.get(link.tag_id);
          if (tag) {
            const existing = linksByTask.get(link.task_id) || [];
            existing.push(tag);
            linksByTask.set(link.task_id, existing);
          }
        }

        const tasksWithTags: TaskWithTags[] = tasksList.map((t) => ({
          ...t,
          tags: linksByTask.get(t.id) || [],
        }));
        setAllTasks(tasksWithTags);

        const overdue = tasksWithTags.filter((t) => isOverdue(t.due_date, t.status));
        const dueToday = tasksWithTags.filter(
          (t) => isToday(t.due_date) && t.status !== "done" && t.status !== "cancelled"
        );
        const inProgress = tasksWithTags.filter((t) => t.status === "in_progress");

        overdue.sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
        dueToday.sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        });

        setOverdueTasks(overdue);
        setTodayTasks(dueToday);
        setInProgressTasks(inProgress);
      }

      if (results[1].status === "fulfilled") {
        setUnreadArticles((results[1].value.data || []) as ReadingItem[]);
      }

      if (results[2].status === "fulfilled") {
        setRecentNotes((results[2].value.data || []) as NoteWithTags[]);
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleTaskStatus = async (taskId: string, status: Task["status"]) => {
    const updates: Partial<Task> = { status };
    if (status === "done") {
      updates.completed_at = new Date().toISOString();
    } else {
      updates.completed_at = null;
    }
    // 在线与离线更新共用原子协议（P1-03）；冲突/失败 toast 可见，刷新取回服务端状态
    const expectedVersion = allTasks.find((task) => task.id === taskId)?.sync_version ?? null;
    const result = await applyTaskUpdate(supabase, taskId, updates as Record<string, unknown>, expectedVersion, crypto.randomUUID());
    if (result.status === "conflict" || result.status === "not_found") {
      toast({ title: result.status === "conflict" ? "任务已在其他设备被修改，已刷新" : "任务不存在或已被删除", variant: "destructive" });
    } else if (result.status === "error" && isNetworkSaveError(result.error)) {
      toast({ title: "网络异常，请稍后重试", variant: "destructive" });
    } else if (result.status === "error") {
      toast({ title: "更新失败，请重试", variant: "destructive" });
    }
    if (result.status === "applied" && status === "done") {
      // 重复任务：标记完成后幂等生成下一次实例（RPC 自检，非重复任务返回 null）
      const newId = await generateNextRecurringTask(supabase, taskId);
      if (newId) window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
    }
    loadData();
  };

  const handleCreateNote = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          // 空标题：编辑页用浅灰占位符「无标题笔记」展示 + 自动聚焦
          title: "",
          content: { type: "doc", content: [{ type: "paragraph" }] },
        })
        .select()
        .single();
      if (error) throw error;
      if (data) {
        router.push(`/notes/${data.id}`);
      }
    } catch {
      toast({ title: "创建笔记失败", variant: "destructive", duration: 2000 });
    }
  };

  const handleCreateTaskList = async () => {
    const name = (await showPrompt({ title: "新建清单", placeholder: "清单名称" }))?.trim();
    if (!name) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("task_lists").insert({
      user_id: user.id,
      name,
      sort_order: Date.now(),
    });
    if (error) {
      toast({ title: "创建清单失败", variant: "destructive", duration: 2000 });
      return;
    }
    toast({ title: "清单已创建", duration: 2000 });
  };

  const handleRecommendNext = () => {
    if (unreadArticles.length === 0) return;
    const randomIndex = Math.floor(Math.random() * unreadArticles.length);
    const article = unreadArticles[randomIndex];
    router.push(`/library/${article.id}`);
  };

  // 完成率/连续天数：纯函数基于全量任务即时计算（分母含已完成项，同窗口口径）
  const todayCompletion = computeTodayCompletion(allTasks, today);
  const taskStreak = computeTaskStreak(allTasks.map((t) => t.completed_at), today);

  const attentionCount = overdueTasks.length + todayTasks.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {getGreeting()}
          </h1>
          <p className="text-muted-foreground mt-1">
            {formatDate(today)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <TaskNavigationMenu
            onCreateList={handleCreateTaskList}
            trigger={(
              <Button size="sm" aria-label="打开待办菜单">
                <ListChecks className="h-4 w-4 mr-1.5" />
                待办
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateNote}
          >
            <FileText className="h-4 w-4 mr-1.5" />
            笔记
          </Button>
          <Link
            href="/library"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <LinkIcon className="h-4 w-4 mr-1.5" />
            链接
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                今日概览
              </h3>
              <Badge variant="secondary">{todayCompletion.rate}%</Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 flex items-center justify-center">
                <svg className="h-16 w-16 -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="text-muted"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeDasharray={`${(todayCompletion.rate / 100) * 175.9} 175.9`}
                    className="text-primary transition-all duration-500"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute text-sm font-bold">{todayCompletion.completed}</span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">完成</span>
                  <span className="font-medium">{todayCompletion.completed} 项</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">待办</span>
                  <span className="font-medium">{todayCompletion.planned - todayCompletion.completed} 项</span>
                </div>
                <div className="flex items-center gap-2">
                  <Flame className="h-3.5 w-3.5 text-orange-500" />
                  <span className="text-muted-foreground">连续</span>
                  <span className="font-medium">{taskStreak} 天</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={cn(attentionCount > 0 && "border-destructive/50")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium flex items-center gap-2">
                <AlertCircle className={cn("h-4 w-4", attentionCount > 0 ? "text-destructive" : "text-muted-foreground")} />
                需要关注
              </h3>
              {attentionCount > 0 && (
                <Badge variant="destructive">{attentionCount}</Badge>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-destructive" />
                  逾期任务
                </span>
                <span className="font-medium text-destructive">{overdueTasks.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  今日到期
                </span>
                <span className="font-medium">{todayTasks.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  进行中
                </span>
                <span className="font-medium">{inProgressTasks.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                待读推荐
              </h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handleRecommendNext}
                disabled={unreadArticles.length === 0}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                随机一篇
              </Button>
            </div>
            {unreadArticles.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {unreadArticles.length} 篇文章待阅读，点击开始阅读吧
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                阅读清单已清空，去稍后读添加新文章
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="p-5 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            逾期任务
            <Badge variant="destructive" className="ml-auto">{overdueTasks.length}</Badge>
          </h3>
        </div>
        <div className="p-5">
          {overdueTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">没有逾期任务，继续保持 🎉</p>
          ) : (
            <div className="space-y-2">
              {overdueTasks.slice(0, 5).map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-md hover:bg-accent transition-colors duration-150 cursor-pointer"
                  )}
                  onClick={() => router.push(`/tasks`)}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleTaskStatus(task.id, "done");
                    }}
                    className="mt-0.5 h-4 w-4 rounded-full border border-destructive/50 flex items-center justify-center hover:bg-destructive/20 transition-colors shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-1">{task.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{TASK_CATEGORY_CONFIG[task.category].icon}</span>
                      <span className="flex items-center gap-1 text-destructive">
                        <Clock className="h-3 w-3" />
                        {formatDueTime(task.due_date)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            今日到期
            <Badge variant="secondary" className="ml-auto">{todayTasks.length}</Badge>
          </h3>
        </div>
        <div className="p-5">
          {todayTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">今天没有到期任务，享受轻松的一天吧</p>
          ) : (
            <div className="space-y-2">
              {todayTasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    "flex items-start gap-2 p-2 rounded-md hover:bg-accent transition-colors duration-150 cursor-pointer"
                  )}
                  onClick={() => router.push(`/tasks`)}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleTaskStatus(task.id, "done");
                    }}
                    className="mt-0.5 h-4 w-4 rounded-full border border-primary flex items-center justify-center hover:bg-primary/20 transition-colors shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-1">{task.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{TASK_CATEGORY_CONFIG[task.category].icon}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDueTime(task.due_date)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-blue-500" />
            进行中
            <Badge variant="secondary" className="ml-auto">{inProgressTasks.length}</Badge>
          </h3>
        </div>
        <div className="p-5">
          {inProgressTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">没有进行中的任务，选择一个开始专注吧</p>
          ) : (
            <div className="space-y-2">
              {inProgressTasks.slice(0, 5).map((task) => (
                <Link
                  key={task.id}
                  href="/tasks"
                  className="flex items-start gap-2 p-2 rounded-md hover:bg-accent transition-colors duration-150"
                >
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleToggleTaskStatus(task.id, "todo");
                    }}
                    className="mt-0.5 h-4 w-4 rounded-full bg-primary/20 border border-primary flex items-center justify-center shrink-0"
                  >
                    <PlayCircle className="h-2.5 w-2.5 text-primary" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-1">{task.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{TASK_CATEGORY_CONFIG[task.category].icon}</span>
                      {task.due_date && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDueTime(task.due_date)}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-orange-500" />
            待读推荐
            <Link
              href="/library"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto h-7 px-2 text-xs")}
            >
              查看全部
            </Link>
          </h3>
        </div>
        <div className="p-5">
          {unreadArticles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">阅读清单是空的，去稍后读添加一些文章</p>
          ) : (
            <div className="space-y-2">
              {unreadArticles.slice(0, 3).map((article) => (
                <Link
                  key={article.id}
                  href={`/library/${article.id}`}
                  className="block p-2 rounded-md hover:bg-accent transition-colors duration-150"
                >
                  <p className="text-sm font-medium line-clamp-1">{article.title || "无标题"}</p>
                  {article.excerpt && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {article.excerpt}
                    </p>
                  )}
                </Link>
              ))}
              {unreadArticles.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={handleRecommendNext}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  推荐下一篇
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <NoteIcon className="h-4 w-4 text-green-500" />
            最近笔记
            <Link
              href="/notes"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto h-7 px-2 text-xs")}
            >
              查看全部
            </Link>
          </h3>
        </div>
        <div className="p-5">
          {recentNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">还没有笔记，开始记录你的想法</p>
          ) : (
            <div className="space-y-2">
              {recentNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className="block p-2 rounded-md hover:bg-accent transition-colors duration-150"
                >
                  <p className="text-sm font-medium line-clamp-1">{note.title || "无标题笔记"}</p>
                  {getNoteExcerpt(note.content) && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {getNoteExcerpt(note.content)}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
