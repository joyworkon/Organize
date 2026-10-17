"use client";
import { readingSourceLabel } from "@/lib/reading/source";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tag as TagIcon, Plus, Pencil, Trash2, Loader2, ArrowLeft, BookOpen, FileText, LayoutList, ListChecks, Lightbulb } from "@/components/icons";
import { PageHeader } from "@/components/layout/page-header";
import { PageSearch } from "@/components/layout/page-search";
import { filterByPageSearch } from "@/lib/search/page-search";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { isOnline } from "@/lib/offline/network";
import type { TagWithCount, TagColor } from "@organize/shared";
import { LESSON_TYPE_CONFIG } from "@organize/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { TagBadge } from "@/components/tags/tag-badge";
import { TagColorPicker } from "@/components/tags/tag-color-picker";
import { Label } from "@/components/ui/label";
import { buildTagCounts } from "./tag-counts";
import { buildTagDetailItems, type TagDetailItems } from "./tag-detail-load";

type DetailFilter = "all" | "reading" | "notes" | "tasks" | "lessons";

export default function TagsPage() {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const supabase = useMemo(() => createClient(), []);
  /** 标签查询失败：没有已加载的标签时显示错误 + 重试，而不是「还没有标签」；有旧列表时保留 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 使用数（四类关联）查询失败：计数不可信，显示「–」/「使用数加载失败」，不冒充 0 */
  const [countsFailed, setCountsFailed] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<TagColor>("blue");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<TagWithCount | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editColor, setEditColor] = useState<TagColor>("blue");
  const [editing, setEditing] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<TagWithCount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [selectedTag, setSelectedTag] = useState<TagWithCount | null>(null);
  const [detailFilter, setDetailFilter] = useState<DetailFilter>("all");
  const [detailItems, setDetailItems] = useState<TagDetailItems>({ readings: [], notes: [], tasks: [], lessons: [] });
  const [detailLoading, setDetailLoading] = useState(false);
  /** 详情条目查询失败：不 setDetailItems 冲掉上次成功快照，空态显示错误 + 重试而不是「暂无内容」 */
  const [detailLoadError, setDetailLoadError] = useState<string | null>(null);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: tagData, error: tagError } = await supabase
        .from("tags")
        .select("id, name, color, created_at")
        .eq("user_id", user.id)
        .order("name", { ascending: true });

      if (tagError) {
        // 查询失败不得当空列表清掉旧标签（谎报「从没建过标签」）：保留旧列表并如实提示；
        // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
        setLoadError(tagError.message || "加载标签失败");
        if (isOnline()) {
          toast({ title: "加载标签失败", description: tagError.message, variant: "destructive" });
        }
        return;
      }

      const [itemTagsRes, noteTagsRes, taskTagsRes, lessonTagsRes] = await Promise.all([
        supabase.from("item_tags").select("tag_id"),
        supabase.from("note_tags").select("tag_id"),
        supabase.from("task_tags").select("tag_id"),
        supabase.from("lesson_tags").select("tag_id"),
      ]);

      const plan = buildTagCounts(tagData || [], user.id, {
        reading: itemTagsRes,
        note: noteTagsRes,
        task: taskTagsRes,
        lesson: lessonTagsRes,
      });

      setTags(plan.tags);
      setLoadError(null);
      setCountsFailed(plan.countsFailed);
      // 使用数查询失败：不冒充「计数为 0」，行内提示常驻，在线时再弹一次 toast
      if (plan.countsFailed && isOnline()) {
        toast({ title: "标签使用数加载失败", variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const fetchTagDetail = useCallback(async (tagId: string) => {
    setDetailLoading(true);
    try {
      const [itemLinksRes, noteLinksRes, taskLinksRes, lessonLinksRes] = await Promise.all([
        supabase.from("item_tags").select("item_id").eq("tag_id", tagId),
        supabase.from("note_tags").select("note_id").eq("tag_id", tagId),
        supabase.from("task_tags").select("task_id").eq("tag_id", tagId),
        supabase.from("lesson_tags").select("lesson_id").eq("tag_id", tagId),
      ]);

      const itemIds = (itemLinksRes.data || []).map((l) => l.item_id);
      const noteIds = (noteLinksRes.data || []).map((l) => l.note_id);
      const taskIds = (taskLinksRes.data || []).map((l) => l.task_id);
      const lessonIds = (lessonLinksRes.data || []).map((l) => l.lesson_id);

      const [readingsRes, notesRes, tasksRes, lessonsRes] = await Promise.all([
        itemIds.length > 0
          ? supabase.from("reading_items").select("*").in("id", itemIds).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        noteIds.length > 0
          ? supabase.from("notes").select("*, tags:tags!note_tags(id, name, color)").in("id", noteIds).order("updated_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        taskIds.length > 0
          ? supabase.from("tasks").select("*").in("id", taskIds).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        lessonIds.length > 0
          ? supabase.from("lessons").select("*").in("id", lessonIds).order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);

      const taskTagLinksRes = taskIds.length > 0
        ? await supabase.from("task_tags").select("task_id, tag_id").in("task_id", taskIds)
        : { data: [] };
      const lessonTagLinksRes = lessonIds.length > 0
        ? await supabase.from("lesson_tags").select("lesson_id, tag_id").in("lesson_id", lessonIds)
        : { data: [] };
      const allTagsRes = await supabase.from("tags").select("id, name, color");

      const { items, loadError } = buildTagDetailItems({
        itemLinks: itemLinksRes,
        noteLinks: noteLinksRes,
        taskLinks: taskLinksRes,
        lessonLinks: lessonLinksRes,
        readings: readingsRes,
        notes: notesRes,
        tasks: tasksRes,
        lessons: lessonsRes,
        taskTagLinks: taskTagLinksRes,
        lessonTagLinks: lessonTagLinksRes,
        allTags: allTagsRes,
      });

      if (loadError) {
        // 查询失败不得把详情清成空列表（谎报「该分类下暂无内容」）：保留上次成功快照并如实提示；
        // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
        setDetailLoadError(loadError);
        if (isOnline()) {
          toast({ title: "加载标签内容失败", variant: "destructive" });
        }
        return;
      }

      setDetailLoadError(null);
      setDetailItems(items);
    } finally {
      setDetailLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    if (selectedTag) {
      fetchTagDetail(selectedTag.id);
    }
  }, [selectedTag, fetchTagDetail]);

  // 标签管理页的"标题"就是标签名，页内搜索口径与其它页一致
  const filtered = filterByPageSearch(tags, search, (t) => ({ title: t.name, tags: [t.name] }));

  const totalUsage = (t: TagWithCount) =>
    (t.note_count || 0) + (t.reading_item_count || 0) + (t.task_count || 0) + (t.lesson_count || 0);

  const openCreateDialog = () => {
    setNewName("");
    setNewColor("blue");
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");

      const { data, error } = await supabase
        .from("tags")
        .upsert({ user_id: user.id, name, color: newColor }, { onConflict: "user_id,name" })
        .select("id, name, color")
        .single();

      if (error) throw error;
      setNewName("");
      setCreateOpen(false);
      await fetchTags();
      window.dispatchEvent(new CustomEvent("organize:tags-changed"));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const openEditDialog = (tag: TagWithCount) => {
    setEditTarget(tag);
    setEditValue(tag.name);
    setEditColor((tag.color as TagColor) || "blue");
  };

  const handleEdit = async () => {
    if (!editTarget || !editValue.trim()) return;
    setEditing(true);
    try {
      const { error } = await supabase
        .from("tags")
        .update({ name: editValue.trim(), color: editColor })
        .eq("id", editTarget.id);
      if (!error) {
        setEditTarget(null);
        if (selectedTag?.id === editTarget.id) {
          setSelectedTag(null);
        }
        await fetchTags();
        window.dispatchEvent(new CustomEvent("organize:tags-changed"));
      }
    } finally {
      setEditing(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("tags").delete().eq("id", deleteTarget.id);
      if (!error) {
        setDeleteTarget(null);
        if (selectedTag?.id === deleteTarget.id) {
          setSelectedTag(null);
        }
        await fetchTags();
        window.dispatchEvent(new CustomEvent("organize:tags-changed"));
      }
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("zh-CN");
  const getHostname = (url: string) => {
    try { return readingSourceLabel(url); } catch { return ""; }
  };

  if (selectedTag) {
    const showReadings = detailFilter === "all" || detailFilter === "reading";
    const showNotes = detailFilter === "all" || detailFilter === "notes";
    const showTasks = detailFilter === "all" || detailFilter === "tasks";
    const showLessons = detailFilter === "all" || detailFilter === "lessons";
    const visibleDetailEmpty =
      (showReadings && detailItems.readings.length === 0) &&
      (showNotes && detailItems.notes.length === 0) &&
      (showTasks && detailItems.tasks.length === 0) &&
      (showLessons && detailItems.lessons.length === 0);
    const hasAnyDetailItem =
      detailItems.readings.length > 0 || detailItems.notes.length > 0 ||
      detailItems.tasks.length > 0 || detailItems.lessons.length > 0;
    const retryDetailLoad = () => {
      if (selectedTag) void fetchTagDetail(selectedTag.id);
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setSelectedTag(null)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <TagBadge tag={selectedTag} size="md" className="!text-sm" />
            </div>
            <p className="text-muted-foreground mt-1 ml-0">
              {countsFailed ? (
                "使用数加载失败"
              ) : (
                <>
                  共 {totalUsage(selectedTag)} 个内容
                  {(selectedTag.reading_item_count || 0) > 0 && ` · ${selectedTag.reading_item_count} 篇文章`}
                  {(selectedTag.note_count || 0) > 0 && ` · ${selectedTag.note_count} 条笔记`}
                  {(selectedTag.task_count || 0) > 0 && ` · ${selectedTag.task_count} 个任务`}
                  {(selectedTag.lesson_count || 0) > 0 && ` · ${selectedTag.lesson_count} 条复盘`}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit flex-wrap">
          {([
            { key: "all" as const, label: "全部", icon: LayoutList },
            { key: "reading" as const, label: "阅读文章", icon: BookOpen },
            { key: "notes" as const, label: "笔记", icon: FileText },
            { key: "tasks" as const, label: "任务", icon: ListChecks },
            { key: "lessons" as const, label: "复盘", icon: Lightbulb },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setDetailFilter(key)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
                detailFilter === key
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* toast 会消失：详情加载失败时旧列表上方要有持久的行内提示 + 就地重试（离线失败由顶栏角标表达，不弹 toast） */}
        {detailLoadError && hasAnyDetailItem && (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2"
            role="alert"
          >
            <p className="text-xs text-destructive">标签内容加载失败</p>
            <Button size="sm" variant="outline" className="shrink-0" onClick={retryDetailLoad}>
              重试
            </Button>
          </div>
        )}

        {detailLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            加载中...
          </div>
        ) : detailLoadError && visibleDetailEmpty ? (
          <EmptyState
            icon={TagIcon}
            title="标签内容加载失败"
            description={detailLoadError}
            action={<Button variant="outline" onClick={retryDetailLoad}>重试</Button>}
          />
        ) : (
          <div className="space-y-2">
            {showReadings && detailItems.readings.map((item) => (
              <Link key={item.id} href={`/library/${item.id}`}>
                <Card className="hover:bg-accent transition-colors duration-150 cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <BookOpen className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium leading-tight line-clamp-1">{item.title || item.url}</h3>
                        {item.excerpt && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{item.excerpt}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <span>阅读文章</span>
                          {getHostname(item.url) && <span>· {getHostname(item.url)}</span>}
                          <span>· {formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}

            {showNotes && detailItems.notes.map((note) => (
              <Link key={note.id} href={`/notes/${note.id}`}>
                <Card className="hover:bg-accent transition-colors duration-150 cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-md bg-accent flex items-center justify-center shrink-0 mt-0.5">
                        <FileText className="h-4 w-4 text-accent-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium leading-tight line-clamp-1">{note.title || "无标题"}</h3>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span>笔记</span>
                          <span>· 更新于 {formatDate(note.updated_at)}</span>
                          {note.tags && note.tags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {note.tags.slice(0, 2).map((tag) => (
                                <TagBadge key={tag.id} tag={tag} size="sm" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}

            {showTasks && detailItems.tasks.map((task) => (
              <div key={task.id} className="cursor-pointer">
                <Card className="hover:bg-accent transition-colors duration-150">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <ListChecks className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={cn("font-medium leading-tight line-clamp-1", task.status === "done" && "line-through text-muted-foreground")}>{task.title}</h3>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span>任务</span>
                          <span className={cn(
                            "px-1 rounded text-[10px]",
                            task.status === "done" ? "bg-success/10 text-success" :
                            task.status === "in_progress" ? "bg-primary/10 text-primary" : "bg-muted"
                          )}>
                            {task.status === "todo" ? "待办" : task.status === "in_progress" ? "进行中" : task.status === "done" ? "已完成" : "已取消"}
                          </span>
                          <span>· {formatDate(task.created_at)}</span>
                          {task.tags && task.tags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {task.tags.slice(0, 2).map((tag) => (
                                <TagBadge key={tag.id} tag={tag} size="sm" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}

            {showLessons && detailItems.lessons.map((lesson) => (
              <Link key={lesson.id} href={`/lessons/${lesson.id}`}>
                <Card className="hover:bg-accent transition-colors duration-150 cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <Lightbulb className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium leading-tight line-clamp-1">{lesson.title || "未命名复盘"}</h3>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span>复盘</span>
                          <span>· {LESSON_TYPE_CONFIG[lesson.lesson_type]?.label ?? "复盘"}</span>
                          <span>· {formatDate(lesson.created_at)}</span>
                          {lesson.tags && lesson.tags.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {lesson.tags.slice(0, 2).map((tag) => (
                                <TagBadge key={tag.id} tag={tag} size="sm" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}

            {!detailLoadError && visibleDetailEmpty && (
              <EmptyState
                icon={TagIcon}
                title="该分类下暂无内容"
              />
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={TagIcon}
        title="标签管理"
        search={
          <PageSearch
            value={search}
            onChange={setSearch}
            placeholder="搜索标签"
          />
        }
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            新建标签
          </Button>
        }
      />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
            <DialogHeader>
              <DialogTitle>新建标签</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tag-name">标签名</Label>
                <Input
                  id="tag-name"
                  placeholder="标签名（最长 32 字符）"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setCreateError(null);
                  }}
                  maxLength={32}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>颜色</Label>
                <TagColorPicker value={newColor} onChange={setNewColor} />
              </div>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                创建
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {/* 桌面端搜索已在页头标题行；窄屏页头会换行，这里不再重复一条搜索带 */}

      {/* toast 会消失：使用数加载失败要有持久的行内提示 + 就地重试（离线失败由顶栏角标表达，不弹 toast） */}
      {countsFailed && (
        <div
          className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2"
          role="alert"
        >
          <p className="text-xs text-destructive">标签使用数加载失败</p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void fetchTags()}>
            重试
          </Button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          加载中...
        </div>
      ) : loadError && tags.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="标签加载失败"
          description={loadError}
          action={<Button variant="outline" onClick={() => void fetchTags()}>重试</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title={search.trim() ? "没有匹配的标签" : "还没有标签"}
          description="创建标签来整理你的内容"
          action={!search.trim() ? (
            <Button onClick={openCreateDialog}>创建标签</Button>
          ) : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tag) => (
            <Card
              key={tag.id}
              className="group hover:bg-accent transition-colors duration-150 cursor-pointer"
              onClick={() => setSelectedTag(tag)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <TagBadge tag={tag} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-0.5">
                        <BookOpen className="h-3 w-3" />
                        {countsFailed ? "–" : tag.reading_item_count || 0}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <FileText className="h-3 w-3" />
                        {countsFailed ? "–" : tag.note_count || 0}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <ListChecks className="h-3 w-3" />
                        {countsFailed ? "–" : tag.task_count || 0}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Lightbulb className="h-3 w-3" />
                        {countsFailed ? "–" : tag.lesson_count || 0}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditDialog(tag);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:text-destructive"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(tag);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {countsFailed ? "使用数加载失败" : `共 ${totalUsage(tag)} 个内容`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑标签</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-tag-name">标签名</Label>
              <Input
                id="edit-tag-name"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                maxLength={32}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleEdit()}
              />
            </div>
            <div className="space-y-2">
              <Label>颜色</Label>
              <TagColorPicker value={editColor} onChange={setEditColor} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>取消</Button>
            <Button onClick={handleEdit} disabled={editing || !editValue.trim()}>
              {editing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除标签</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定删除标签 <TagBadge tag={{ id: deleteTarget?.id || "", name: deleteTarget?.name || "", color: deleteTarget?.color }} size="sm" className="!mx-1" />？
            {countsFailed ? (
              <> 暂时无法确认该标签用在多少内容上，删除后会自动从这些内容上移除。</>
            ) : (
              deleteTarget && totalUsage(deleteTarget) > 0 && (
                <> 该标签当前用在 {totalUsage(deleteTarget)} 个内容上，删除后会自动从这些内容上移除。</>
              )
            )}
            此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
