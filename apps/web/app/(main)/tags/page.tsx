"use client";

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
import { Tag as TagIcon, Plus, Pencil, Trash2, Search, Loader2, ArrowLeft, BookOpen, FileText, LayoutList, ListChecks, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tag, TagWithCount, NoteWithTags, ReadingItem, TaskWithTags, LessonWithTags, TagColor } from "@organize/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { TagBadge } from "@/components/tags/tag-badge";
import { TagColorPicker } from "@/components/tags/tag-color-picker";
import { Label } from "@/components/ui/label";

type DetailFilter = "all" | "reading" | "notes" | "tasks" | "lessons";

export default function TagsPage() {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const supabase = useMemo(() => createClient(), []);

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
  const [detailItems, setDetailItems] = useState<{ readings: ReadingItem[]; notes: NoteWithTags[]; tasks: TaskWithTags[]; lessons: LessonWithTags[] }>({ readings: [], notes: [], tasks: [], lessons: [] });
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: tagData } = await supabase
        .from("tags")
        .select("id, name, color, created_at")
        .eq("user_id", user.id)
        .order("name", { ascending: true });

      const [itemTagsRes, noteTagsRes, taskTagsRes, lessonTagsRes] = await Promise.all([
        supabase.from("item_tags").select("tag_id"),
        supabase.from("note_tags").select("tag_id"),
        supabase.from("task_tags").select("tag_id"),
        supabase.from("lesson_tags").select("tag_id"),
      ]);

      const countMap = new Map<string, { note_count: number; reading_item_count: number; task_count: number; lesson_count: number }>();
      for (const row of itemTagsRes.data || []) {
        const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
        entry.reading_item_count += 1;
        countMap.set(row.tag_id, entry);
      }
      for (const row of noteTagsRes.data || []) {
        const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
        entry.note_count += 1;
        countMap.set(row.tag_id, entry);
      }
      for (const row of taskTagsRes.data || []) {
        const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
        entry.task_count += 1;
        countMap.set(row.tag_id, entry);
      }
      for (const row of lessonTagsRes.data || []) {
        const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
        entry.lesson_count += 1;
        countMap.set(row.tag_id, entry);
      }

      const result: TagWithCount[] = (tagData || []).map((t) => ({
        id: t.id,
        user_id: user.id,
        name: t.name,
        color: t.color || "blue",
        ...(countMap.get(t.id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 }),
      }));
      setTags(result);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const fetchTagDetail = useCallback(async (tagId: string) => {
    setDetailLoading(true);
    try {
      const [{ data: itemLinks }, { data: noteLinks }, { data: taskLinks }, { data: lessonLinks }] = await Promise.all([
        supabase.from("item_tags").select("item_id").eq("tag_id", tagId),
        supabase.from("note_tags").select("note_id").eq("tag_id", tagId),
        supabase.from("task_tags").select("task_id").eq("tag_id", tagId),
        supabase.from("lesson_tags").select("lesson_id").eq("tag_id", tagId),
      ]);

      const itemIds = (itemLinks || []).map((l) => l.item_id);
      const noteIds = (noteLinks || []).map((l) => l.note_id);
      const taskIds = (taskLinks || []).map((l) => l.task_id);
      const lessonIds = (lessonLinks || []).map((l) => l.lesson_id);

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
      const { data: allTagsForUser } = await supabase.from("tags").select("id, name, color");
      const tagMap = new Map((allTagsForUser || []).map((t: any) => [t.id, t as Tag]));

      const taskTagsByTask = new Map<string, Tag[]>();
      for (const link of taskTagLinksRes.data || []) {
        const tag = tagMap.get(link.tag_id);
        if (tag) {
          const existing = taskTagsByTask.get(link.task_id) || [];
          existing.push(tag);
          taskTagsByTask.set(link.task_id, existing);
        }
      }

      const lessonTagsByLesson = new Map<string, Tag[]>();
      for (const link of lessonTagLinksRes.data || []) {
        const tag = tagMap.get(link.tag_id);
        if (tag) {
          const existing = lessonTagsByLesson.get(link.lesson_id) || [];
          existing.push(tag);
          lessonTagsByLesson.set(link.lesson_id, existing);
        }
      }

      setDetailItems({
        readings: (readingsRes.data || []) as unknown as ReadingItem[],
        notes: (notesRes.data || []) as unknown as NoteWithTags[],
        tasks: ((tasksRes.data || []) as any[]).map((t) => ({ ...t, tags: taskTagsByTask.get(t.id) || [] })) as TaskWithTags[],
        lessons: ((lessonsRes.data || []) as any[]).map((l) => ({ ...l, tags: lessonTagsByLesson.get(l.id) || [] })) as LessonWithTags[],
      });
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

  const filtered = tags.filter((t) =>
    !search.trim() ? true : t.name.toLowerCase().includes(search.trim().toLowerCase())
  );

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
      }
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("zh-CN");
  const getHostname = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };

  if (selectedTag) {
    const showReadings = detailFilter === "all" || detailFilter === "reading";
    const showNotes = detailFilter === "all" || detailFilter === "notes";
    const showTasks = detailFilter === "all" || detailFilter === "tasks";
    const showLessons = detailFilter === "all" || detailFilter === "lessons";

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
              共 {totalUsage(selectedTag)} 个内容
              {(selectedTag.reading_item_count || 0) > 0 && ` · ${selectedTag.reading_item_count} 篇文章`}
              {(selectedTag.note_count || 0) > 0 && ` · ${selectedTag.note_count} 条笔记`}
              {(selectedTag.task_count || 0) > 0 && ` · ${selectedTag.task_count} 个任务`}
              {(selectedTag.lesson_count || 0) > 0 && ` · ${selectedTag.lesson_count} 条经验`}
            </p>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit flex-wrap">
          {([
            { key: "all" as const, label: "全部", icon: LayoutList },
            { key: "reading" as const, label: "阅读文章", icon: BookOpen },
            { key: "notes" as const, label: "笔记", icon: FileText },
            { key: "tasks" as const, label: "任务", icon: ListChecks },
            { key: "lessons" as const, label: "经验", icon: Lightbulb },
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

        {detailLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            加载中...
          </div>
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
                      <div className="h-8 w-8 rounded-md bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                        <ListChecks className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={cn("font-medium leading-tight line-clamp-1", task.status === "done" && "line-through text-muted-foreground")}>{task.title}</h3>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span>任务</span>
                          <span className={cn(
                            "px-1 rounded text-[10px]",
                            task.status === "done" ? "bg-green-500/10 text-green-600 dark:text-green-400" :
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
                      <div className="h-8 w-8 rounded-md bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium leading-tight line-clamp-1">{lesson.title || "未命名经验"}</h3>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span>经验</span>
                          <span>· {lesson.lesson_type === "reflection" ? "复盘" : lesson.lesson_type === "lesson" ? "经验" : "灵感"}</span>
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

            {((showReadings && detailItems.readings.length === 0) &&
              (showNotes && detailItems.notes.length === 0) &&
              (showTasks && detailItems.tasks.length === 0) &&
              (showLessons && detailItems.lessons.length === 0)) && (
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">标签管理</h1>
          <p className="text-muted-foreground mt-1">
            共 {tags.length} 个标签，累计使用 {tags.reduce((sum, t) => sum + totalUsage(t), 0)} 次
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            新建标签
          </Button>
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
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="筛选标签..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          加载中...
        </div>
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
                        {tag.reading_item_count || 0}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <FileText className="h-3 w-3" />
                        {tag.note_count || 0}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <ListChecks className="h-3 w-3" />
                        {tag.task_count || 0}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <Lightbulb className="h-3 w-3" />
                        {tag.lesson_count || 0}
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
                  共 {totalUsage(tag)} 个内容
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
            {deleteTarget && totalUsage(deleteTarget) > 0 && (
              <> 该标签当前用在 {totalUsage(deleteTarget)} 个内容上，删除后会自动从这些内容上移除。</>
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
