"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { generateNextRecurringTask } from "@/lib/tasks/recurring";
import { DashboardSection, DashboardViewHeader } from "./dashboard-layout";
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
import { filterByPageSearch } from "@/lib/search/page-search";
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
  ChevronRight,
  Feather,
} from "@/components/icons";
import { TaskNavigationMenu } from "@/components/tasks/task-navigation-menu";
import { DashboardCapture } from "./dashboard-capture";
import { mergeActionableTasks } from "@/lib/dashboard/workbench-tasks";
import { fetchAllRows } from "@/lib/dashboard/paginated-query";
import { localCalendarDayDifference } from "@/lib/dashboard/workbench-stats";

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
  const days = localCalendarDayDifference(now, date);
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

export default function TodayView({ search = "", searchControl }: { search?: string; searchControl?: ReactNode } = {}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadedModules, setLoadedModules] = useState({ tasks: false, reading: false, notes: false, memos: false });
  // 问候语与日期依赖浏览器本地时区：SSR 与客户端时区不同会触发 hydration
  // 不匹配，所以首帧渲染中性文案，挂载后再按本地时间计算。
  const [greeting, setGreeting] = useState<{ title: string; date: string } | null>(null);
  useEffect(() => {
    setGreeting({ title: getGreeting(), date: formatDate(new Date()) });
  }, []);
  const [overdueTasks, setOverdueTasks] = useState<TaskWithTags[]>([]);
  const [todayTasks, setTodayTasks] = useState<TaskWithTags[]>([]);
  const [inProgressTasks, setInProgressTasks] = useState<TaskWithTags[]>([]);
  const [unreadArticles, setUnreadArticles] = useState<ReadingItem[]>([]);
  const [recentNotes, setRecentNotes] = useState<NoteWithTags[]>([]);
  // D03 §5.1：最近速记（最多 3 条；沿用 /api/memos 既有路径）
  const [recentMemos, setRecentMemos] = useState<Array<{ id: string; content: string; created_at: string }>>([]);
  // 全量任务驻留内存：完成率与连续天数都由它即时计算（纯函数，见 lib/dashboard/workbench-stats）
  const [allTasks, setAllTasks] = useState<TaskWithTags[]>([]);
  const [justCreatedTasks, setJustCreatedTasks] = useState<TaskWithTags[]>([]);
  const [taskBusyIds, setTaskBusyIds] = useState<Set<string>>(() => new Set());
  const requestGeneration = useRef(0);

  const today = new Date();

  const loadData = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setLoadError(false);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) {
        router.push("/login");
        return;
      }

      const results = await Promise.allSettled([
        fetchAllRows(supabase.from("tasks").select("*").eq("user_id", user.id).order("id", { ascending: true })),
        supabase.from("reading_items")
          .select("*, item_tags(tag_id, tags(id, name))")
          .eq("user_id", user.id).eq("reading_status", "reading")
          .order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(5),
        supabase.from("reading_items")
          .select("*, item_tags(tag_id, tags(id, name))")
          .eq("user_id", user.id).eq("reading_status", "unread")
          .order("is_pinned", { ascending: false }).order("created_at", { ascending: false }).limit(5),
        supabase.from("notes")
          .select("*, reading_item:reading_items(id, title, url), note_tags(tag_id, tags(id, name))")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(5),
      ]);

      if (generation !== requestGeneration.current) return;

      if (results.some((result) => result.status === "rejected" || (result.status === "fulfilled" && "error" in result.value && !!result.value.error))) setLoadError(true);

      if (results[0].status === "fulfilled") {
        const tasksList = results[0].value as Task[];
        try {
          const [tagLinks, tagsData] = await Promise.all([
            fetchAllRows(supabase.from("task_tags").select("task_id, tag_id").order("task_id", { ascending: true }).order("tag_id", { ascending: true })),
            fetchAllRows(supabase.from("tags").select("id, name").eq("user_id", user.id).order("id", { ascending: true })),
          ]);
          if (generation !== requestGeneration.current) return;
          const tagMap = new Map(tagsData.map((t) => [t.id, t as Tag]));
          const linksByTask = new Map<string, Tag[]>();
          for (const link of tagLinks) {
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
          setLoadedModules((current) => ({ ...current, tasks: true }));
        } catch (error) {
          console.error("Failed to load dashboard task tags:", error);
          if (generation === requestGeneration.current) setLoadError(true);
        }
      }

      if (results[1].status === "fulfilled" && !results[1].value.error && results[2].status === "fulfilled" && !results[2].value.error) {
        const mapTags = (rows: unknown) => ((rows || []) as Array<ReadingItem & { item_tags?: Array<{ tags?: Tag }> }>).map((article) => ({
          ...article,
          tags: article.item_tags?.flatMap((link) => link.tags ? [link.tags] : []) ?? article.tags ?? [],
        }));
        setUnreadArticles([...mapTags(results[1].value.data), ...mapTags(results[2].value.data)].slice(0, 5));
        setLoadedModules((current) => ({ ...current, reading: true }));
      }

      if (results[3].status === "fulfilled" && !results[3].value.error) {
        const notes = (results[3].value.data || []) as Array<NoteWithTags & { note_tags?: Array<{ tags?: Tag }> }>;
        setRecentNotes(notes.map((note) => ({ ...note, tags: note.note_tags?.flatMap((link) => link.tags ? [link.tags] : []) ?? note.tags ?? [] })));
        setLoadedModules((current) => ({ ...current, notes: true }));
      }

      try {
        const res = await fetch("/api/memos?limit=3", { cache: "no-store" });
        if (res.ok) {
          const memos = await res.json();
          if (generation === requestGeneration.current) {
            setRecentMemos(memos.slice(0, 3));
            setLoadedModules((current) => ({ ...current, memos: true }));
          }
        } else if (generation === requestGeneration.current) setLoadError(true);
      } catch {
        // 速记加载失败不阻塞工作台其余模块
        if (generation === requestGeneration.current) setLoadError(true);
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
      if (generation === requestGeneration.current) setLoadError(true);
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false);
        setHasLoaded(true);
      }
    }
  }, [supabase, router]);

  useEffect(() => {
    loadData();
    const reload = () => void loadData();
    window.addEventListener("organize:memos-synced", reload);
    window.addEventListener("organize:tasks-changed", reload);
    window.addEventListener("reading:item-created", reload);
    return () => {
      requestGeneration.current += 1;
      window.removeEventListener("organize:memos-synced", reload);
      window.removeEventListener("organize:tasks-changed", reload);
      window.removeEventListener("reading:item-created", reload);
    };
  }, [loadData]);

  const handleToggleTaskStatus = async (taskId: string, status: Task["status"]) => {
    if (taskBusyIds.has(taskId)) return;
    setTaskBusyIds((previous) => new Set(previous).add(taskId));
    try {
      const updates: Partial<Task> = { status };
      updates.completed_at = status === "done" ? new Date().toISOString() : null;
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
        const newId = await generateNextRecurringTask(supabase, taskId);
        if (newId) window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
      }
      if (result.status === "applied") {
        setJustCreatedTasks((current) => current.filter((task) => task.id !== taskId));
      }
      await loadData();
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "更新失败，请重试", variant: "destructive" });
      await loadData();
    } finally {
      setTaskBusyIds((previous) => {
        const next = new Set(previous);
        next.delete(taskId);
        return next;
      });
    }
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
    if (visibleArticles.length === 0) return;
    const randomIndex = Math.floor(Math.random() * visibleArticles.length);
    const article = visibleArticles[randomIndex];
    router.push(`/library/${article.id}`);
  };

  // 完成率/连续天数：纯函数基于全量任务即时计算（分母含已完成项，同窗口口径）
  const todayCompletion = computeTodayCompletion(allTasks, today);
  const taskStreak = computeTaskStreak(allTasks.map((t) => t.completed_at), today);

  // D03 §5.1「继续处理」：逾期 → 今日到期 → 进行中 合并的待办清单（各段保持原排序）
  const actionableTasks: TaskWithTags[] = filterByPageSearch(
    mergeActionableTasks(overdueTasks, todayTasks, inProgressTasks, justCreatedTasks),
    search,
    (task) => ({ title: task.title, tags: task.tags })
  );
  // 页内搜索只作用在工作台自己展示的四组内容上（待办 / 阅读 / 笔记 / 速记）
  const visibleArticles = filterByPageSearch(unreadArticles, search, (article) => ({
    title: article.title || article.url,
    extra: [article.excerpt],
    tags: article.tags,
  }));
  const visibleNotes = filterByPageSearch(recentNotes, search, (note) => ({
    title: note.title,
    tags: note.tags,
  }));
  const visibleMemos = filterByPageSearch(recentMemos, search, (memo) => ({ title: memo.content }));

  return (
    <div className="dashboard-today space-y-5">
      <DashboardViewHeader
        title={greeting?.title ?? "你好"}
        description={greeting?.date ?? "\u00a0"}
        actions={
          <>
            <div className="dashboard-mobile-search">{searchControl}</div>
            <div className="dashboard-quick-links flex items-center gap-2 flex-wrap">
              <TaskNavigationMenu
                onCreateList={handleCreateTaskList}
                trigger={
                  <Button variant="outline" size="sm" aria-label="打开待办菜单">
                    <ListChecks className="h-4 w-4 mr-1.5" />
                    待办
                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                }
              />
              <Button variant="outline" size="sm" onClick={handleCreateNote}>
                <FileText className="h-4 w-4 mr-1.5" />
                笔记
              </Button>
              <Link
                href="/library"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                )}
              >
                <LinkIcon className="h-4 w-4 mr-1.5" />
                链接
              </Link>
            </div>
          </>
        }
      />

      {loading && !hasLoaded ? (
        <div className="dashboard-loading" role="status">
          <Loader2 className="h-5 w-5 animate-spin" /> 加载中…
        </div>
      ) : (
        <>
          <DashboardCapture onAdded={(task) => {
            if (task) setJustCreatedTasks((current) => [
              { ...task, tags: [] } as TaskWithTags,
              ...current.filter((item) => item.id !== task.id),
            ]);
            void loadData();
          }} />
          {loadError && (
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 px-3 py-2 text-sm" role="alert">
              <span>部分内容暂时无法加载，已加载的内容仍可查看。请重试。</span>
              <Button variant="outline" size="sm" onClick={() => void loadData()}>重试</Button>
            </div>
          )}

          <div className="dashboard-content-grid">
            {/* 主列（约 2/3）：继续处理 */}
            <div className="lg:col-span-2 space-y-4">
              <DashboardSection
                title="继续处理"
                actions={
                  <div className="flex items-center gap-3">
                    {overdueTasks.length > 0 && (
                      <span className="dashboard-metric-alert">
                        逾期 {overdueTasks.length}
                      </span>
                    )}
                    <Link href="/tasks?scope=all" className="dashboard-section-link">
                      全部待办 <ChevronRight className="h-3 w-3" />
                    </Link>
                  </div>
                }
              >
                {loadedModules.tasks && <div className="dashboard-metric-row mb-3">
                  {/* 文案直说含义：「1/1 今日完成」「1 连续天数」读不出分子分母各是什么 */}
                  <span title="今天到期或计划在今天的任务中，已完成的数量">
                    <strong>{todayCompletion.completed}</strong>
                    今天已完成（共 {todayCompletion.planned} 项）
                  </span>
                  <span title="连续每天都至少完成一项任务的天数">
                    <strong>{taskStreak}</strong>
                    天连续完成
                  </span>
                </div>}
                {!loadedModules.tasks ? (
                  <p className="text-sm text-muted-foreground text-center py-6">待办数据暂时无法加载</p>
                ) : actionableTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {search.trim()
                      ? "没有匹配的待办"
                      : "今天没有待办，享受轻松的一天吧"}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {actionableTasks.slice(0, 5).map((task) => {
                      const overdue = isOverdue(task.due_date, task.status);
                      return (
                        <div
                          key={task.id}
                          className="flex items-start gap-2 p-2 rounded-md hover:bg-accent transition-colors duration-150 cursor-pointer"
                          onClick={() => router.push(`/tasks?scope=all&task=${task.id}`)}
                        >
                          <button
                            aria-label="标记完成"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleTaskStatus(
                                task.id,
                                "done",
                              );
                            }}
                            disabled={taskBusyIds.has(task.id)}
                            className={cn(
                              "mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center transition-colors shrink-0",
                              task.status === "in_progress"
                                ? "bg-primary/20 border-primary"
                                : overdue
                                  ? "border-destructive/50 hover:bg-destructive/20"
                                  : "border-primary hover:bg-primary/20",
                            )}
                          >
                            {task.status === "in_progress" && (
                              <PlayCircle className="h-2.5 w-2.5 text-primary" />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium line-clamp-1">
                              {task.title}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                              <span>
                                {TASK_CATEGORY_CONFIG[task.category].icon}
                              </span>
                              <span
                                className={cn(overdue && "text-destructive")}
                              >
                                {task.status === "in_progress"
                                  ? "进行中"
                                  : formatDueTime(task.due_date)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </DashboardSection>

              <DashboardSection
                title="继续阅读"
                icon={BookOpen}
                actions={
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px] font-normal text-muted-foreground"
                      onClick={handleRecommendNext}
                      disabled={visibleArticles.length === 0}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      随机一篇
                    </Button>
                    <Link href="/library" className="dashboard-section-link">
                      全部
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  </div>
                }
              >
                {!loadedModules.reading ? (
                  <p className="text-sm text-muted-foreground text-center py-6">阅读数据暂时无法加载</p>
                ) : visibleArticles.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {search.trim()
                      ? "没有匹配的文章"
                      : "阅读清单已清空，去稍后读添加新文章"}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {visibleArticles.slice(0, 4).map((article) => (
                      <Link
                        key={article.id}
                        href={`/library/${article.id}`}
                        className="block p-2 rounded-md hover:bg-accent transition-colors duration-150"
                      >
                        <p className="text-sm font-medium line-clamp-1">
                          {article.title || "无标题"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {article.reading_status === "reading" && <span>在读 · {Math.round((article.reading_progress || 0) * 100)}% · </span>}
                          {article.excerpt
                            ? article.excerpt.slice(0, 60)
                            : "未读"}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </DashboardSection>
            </div>

            {/* 辅列（约 1/3）：最近笔记 + 最近速记 */}
            <div className="space-y-4">
              <DashboardSection
                title="最近笔记"
                icon={NoteIcon}
                actions={
                  <Link href="/notes" className="dashboard-section-link">
                    全部 <ChevronRight className="h-3 w-3" />
                  </Link>
                }
              >
                {!loadedModules.notes ? (
                  <p className="text-sm text-muted-foreground text-center py-6">笔记数据暂时无法加载</p>
                ) : visibleNotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {search.trim()
                      ? "没有匹配的笔记"
                      : "还没有笔记，开始记录你的想法"}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {visibleNotes.slice(0, 5).map((note) => (
                      <Link
                        key={note.id}
                        href={`/notes/${note.id}`}
                        className="block rounded-md px-2 py-1.5 hover:bg-accent transition-colors duration-150"
                      >
                        <p className="text-sm font-medium line-clamp-1">
                          {note.title || "无标题笔记"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(note.updated_at).toLocaleDateString(
                            "zh-CN",
                          )}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </DashboardSection>

              <DashboardSection
                title="最近速记"
                icon={Feather}
                actions={
                  <Link
                    href="/library?view=memos"
                    className="dashboard-section-link"
                  >
                    全部 <ChevronRight className="h-3 w-3" />
                  </Link>
                }
              >
                {!loadedModules.memos ? (
                  <p className="text-sm text-muted-foreground text-center py-6">速记数据暂时无法加载</p>
                ) : visibleMemos.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {search.trim()
                      ? "没有匹配的速记"
                      : "上方输入框可快速记一条"}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {visibleMemos.map((memo) => (
                      <Link
                        key={memo.id}
                        // F05：沿用 ?memo= 深链合同（阶段 C 起指向资料库速记视图），搜索/工作台/外链定位同一目标
                        href={`/library?view=memos&memo=${memo.id}`}
                        className="block rounded-md px-2 py-1.5 hover:bg-accent transition-colors duration-150"
                      >
                        <p className="text-sm line-clamp-2">{memo.content}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(memo.created_at).toLocaleDateString(
                            "zh-CN",
                          )}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </DashboardSection>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
