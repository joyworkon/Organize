"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ArrowLeft, Loader2, Save, Trash2, Pencil, X, BookOpen, FileText, CheckCircle2, Lightbulb, MoreHorizontal } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TagSelector } from "@/components/tags/tag-selector";
import { TagBadge } from "@/components/tags/tag-badge";
import { cn } from "@/lib/utils";
import type { LessonWithTags, LessonType, Tag, Task, ReadingItem, Note } from "@organize/shared";
import { LESSON_TYPE_CONFIG } from "@organize/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/hooks/use-toast";
import { mutateTrash } from "@/lib/trash/client";
import {
  LESSON_TAGS_LOAD_ERROR_MESSAGE,
  planLessonTagSave,
  resolveLessonTagsAfterLoad,
} from "@/lib/lessons/detail-tags";
import { showConfirm } from "@/components/ui/prompt-dialog";

function nodeText(node: any): string {
  if (!node) return "";
  if (node.text) return node.text;
  if (node.content) return (node.content as any[]).map(nodeText).join("\n");
  return "";
}

function textToContent(text: string): Record<string, unknown> {
  if (!text.trim()) {
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    };
  }
  const paragraphs = text.split(/\n\n+/).map((p) => ({
    type: "paragraph",
    content: p.trim()
      ? p.split(/\n/).flatMap((line, i) => [
          ...(i > 0 ? [{ type: "hardBreak" }] : []),
          { type: "text", text: line },
        ])
      : [],
  }));
  return {
    type: "doc",
    content: paragraphs,
  };
}

function formatContentText(text: string) {
  return text.split(/\n\n+/).map((p, i) => (
    <p key={i} className="whitespace-pre-wrap leading-relaxed mb-3 last:mb-0">
      {p}
    </p>
  ));
}

export default function LessonEditorPage() {
  const router = useRouter();
  const params = useParams();
  const lessonId = params.id as string;
  const isNew = lessonId === "new";

  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(isNew);
  const [missing, setMissing] = useState(false);

  const [title, setTitle] = useState("");
  const [contentText, setContentText] = useState("");
  const [lessonType, setLessonType] = useState<LessonType>("reflection");

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Pick<Tag, "id" | "name" | "color">[]>([]);

  const [linkTaskId, setLinkTaskId] = useState<string>("");
  const [linkReadingId, setLinkReadingId] = useState<string>("");
  const [linkNoteId, setLinkNoteId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [readingItems, setReadingItems] = useState<ReadingItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  const [linkedTask, setLinkedTask] = useState<Task | null>(null);
  const [linkedReading, setLinkedReading] = useState<ReadingItem | null>(null);
  const [linkedNote, setLinkedNote] = useState<Note | null>(null);
  const [loadedTags, setLoadedTags] = useState<Tag[]>([]);
  /** 标签（tags 全量 + lesson_tags 关联）加载失败：不伪装成「没有标签」，保存时 skip 不删已有标签 */
  const [tagsLoadError, setTagsLoadError] = useState<string | null>(null);

  const fetchLesson = useCallback(async () => {
    if (isNew) {
      setMissing(false);
      setEditing(true);
      return;
    }
    setMissing(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: tagsData, error: tagsError }, { data: tasksData }, { data: readingsData }, { data: notesData }] = await Promise.all([
        supabase.from("tags").select("id, name, color").eq("user_id", user.id).order("name"),
        supabase.from("tasks").select("id, title").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("reading_items").select("id, title").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("notes").select("id, title").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(50),
      ]);

      setAllTags((tagsData || []) as Tag[]);
      setTasks((tasksData || []) as Task[]);
      setReadingItems((readingsData || []) as ReadingItem[]);
      setNotes((notesData || []) as Note[]);

      const { data, error: lessonError } = await supabase
        .from("lessons")
        .select("*")
        .eq("id", lessonId)
        .eq("user_id", user.id)
        .single();

      if (lessonError || !data) {
        setMissing(true);
      } else {
        setTitle(data.title || "");
        setContentText(nodeText(data.content));
        setLessonType(data.lesson_type);
        setLinkTaskId(data.task_id || "");
        setLinkReadingId(data.reading_item_id || "");
        setLinkNoteId(data.note_id || "");

        if (data.task_id) {
          const { data: taskData } = await supabase.from("tasks").select("id, title").eq("id", data.task_id).single();
          setLinkedTask((taskData as Task) || null);
        }
        if (data.reading_item_id) {
          const { data: readingData } = await supabase.from("reading_items").select("id, title").eq("id", data.reading_item_id).single();
          setLinkedReading((readingData as ReadingItem) || null);
        }
        if (data.note_id) {
          const { data: noteData } = await supabase.from("notes").select("id, title").eq("id", data.note_id).single();
          setLinkedNote((noteData as Note) || null);
        }

        const { data: tagLinks, error: tagLinksError } = await supabase.from("lesson_tags").select("tag_id").eq("lesson_id", lessonId);
        const tagsPlan = resolveLessonTagsAfterLoad({
          allTags: (tagsData || null) as Tag[] | null,
          allTagsError: tagsError,
          links: tagLinks,
          linksError: tagLinksError,
        });
        setSelectedTags(tagsPlan.tags.map(t => ({ id: t.id, name: t.name, color: t.color })));
        setLoadedTags(tagsPlan.tags);
        setTagsLoadError(tagsPlan.loadError);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, lessonId, isNew]);

  useEffect(() => {
    fetchLesson();
  }, [fetchLesson]);

  useEffect(() => {
    if (editing && isNew) {
      const loadOptions = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const [{ data: tagsData }, { data: tasksData }, { data: readingsData }, { data: notesData }] = await Promise.all([
          supabase.from("tags").select("id, name, color").eq("user_id", user.id).order("name"),
          supabase.from("tasks").select("id, title").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
          supabase.from("reading_items").select("id, title").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
          supabase.from("notes").select("id, title").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(50),
        ]);
        setAllTags((tagsData || []) as Tag[]);
        setTasks((tasksData || []) as Task[]);
        setReadingItems((readingsData || []) as ReadingItem[]);
        setNotes((notesData || []) as Note[]);
      };
      loadOptions();
    }
  }, [editing, isNew, supabase]);

  const handleCreateTag = async (name: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("tags")
      .upsert({ user_id: user.id, name, color: "blue" }, { onConflict: "user_id,name" })
      .select("id, name, color")
      .single();
    if (error || !data) return null;
    setAllTags(prev => {
      if (prev.some(t => t.id === data.id)) return prev;
      return [...prev, data as Tag];
    });
    return data.id;
  };

  const handleTagChange = async (next: Pick<Tag, "id" | "name" | "color">[]) => {
    const resolved: Pick<Tag, "id" | "name" | "color">[] = [];
    for (const t of next) {
      if (t.id.startsWith("new:")) {
        const realId = await handleCreateTag(t.name);
        if (realId) {
          const createdTag = allTags.find(tag => tag.id === realId);
          resolved.push({ id: realId, name: t.name, color: createdTag?.color || "blue" });
        }
      } else {
        resolved.push(t);
      }
    }
    setSelectedTags(resolved);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload = {
        user_id: user.id,
        title: title.trim() || "未命名复盘",
        content: contentText.trim() ? textToContent(contentText) : null,
        lesson_type: lessonType,
        task_id: linkTaskId || null,
        reading_item_id: linkReadingId || null,
        note_id: linkNoteId || null,
      };

      let savedId: string;
      if (isNew) {
        const { data, error } = await supabase
          .from("lessons")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        savedId = data.id;
        if (selectedTags.length > 0) {
          const links = selectedTags.map(t => ({ lesson_id: savedId, tag_id: t.id }));
          await supabase.from("lesson_tags").insert(links);
        }
      } else {
        savedId = lessonId;
        const { error } = await supabase
          .from("lessons")
          .update(payload)
          .eq("id", lessonId);
        if (error) throw error;
        const tagPlan = planLessonTagSave({ tagsLoadError, selectedTagIds: selectedTags.map(t => t.id) });
        if (tagPlan.kind === "replace") {
          const { error: deleteError } = await supabase.from("lesson_tags").delete().eq("lesson_id", lessonId);
          let tagSaveFailed = Boolean(deleteError);
          if (tagPlan.tagIds.length > 0) {
            const links = tagPlan.tagIds.map(tag_id => ({ lesson_id: savedId, tag_id }));
            const { error: insertError } = await supabase.from("lesson_tags").insert(links);
            tagSaveFailed = tagSaveFailed || Boolean(insertError);
          }
          // 复盘正文已保存成功，标签失败不阻断跳转，用 toast 告知
          if (tagSaveFailed) {
            toast({ title: "标签保存失败", variant: "destructive" });
          }
        }
      }

      router.push(`/lessons/${savedId}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isNew) {
      router.push("/tasks/lessons");
      return;
    }
    const confirmed = await showConfirm({
      title: "移入垃圾箱？",
      description: "这条复盘会移入垃圾箱，之后可以恢复。",
      confirmText: "移入垃圾箱",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await mutateTrash("lesson", [lessonId], "soft_delete");
      toast({ title: "复盘已移入垃圾箱" });
      router.push("/tasks/lessons");
    } catch (error) {
      toast({
        title: "删除失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const typeConfig = LESSON_TYPE_CONFIG[lessonType];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (missing) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="复盘不存在或已被删除"
        description="已删除的复盘可以在垃圾箱中恢复"
        action={
          <div className="flex items-center gap-2">
            <Link href="/tasks/lessons">
              <Button variant="outline">返回复盘列表</Button>
            </Link>
            <Link href="/trash">
              <Button>打开垃圾箱</Button>
            </Link>
          </div>
        }
      />
    );
  }

  const getCurrentPageText = () => {
    if (isNew) return "新建复盘";
    if (editing) return "编辑";
    return title || "复盘";
  };

  return (
    <div className="w-full space-y-6">
      {/* 详情页操作行统一壳（与笔记 / 任务详情同几何：44px 行高、吸顶、无常驻分隔线） */}
      <div className="organize-detail-bar -mx-4 -mt-4 mb-2 md:-mx-6 md:-mt-6">
        <div className="organize-detail-bar-inner">
          <div className="organize-detail-bar-group organize-detail-bar-nav">
            <Link href="/tasks/lessons" className="organize-detail-bar-back" aria-label="返回复盘">
              <ArrowLeft className="h-4 w-4" />
              返回
            </Link>
            <Breadcrumb className="min-w-0">
          <BreadcrumbList>
            <BreadcrumbItem className="hidden sm:inline-flex">
              <BreadcrumbLink href="/">首页</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:block" />
            <BreadcrumbItem>
              <BreadcrumbLink href="/tasks/lessons">复盘</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage
                className="max-w-[20ch] sm:max-w-[30ch]"
                title={getCurrentPageText()}
              >
                {getCurrentPageText()}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="organize-detail-bar-group organize-detail-bar-actions">
            {!editing && !isNew && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4 mr-1" />
                编辑
              </Button>
            )}
            {editing && !isNew && (
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); fetchLesson(); }}>
                <X className="h-4 w-4 mr-1" />
                取消编辑
              </Button>
            )}
            {!isNew && (
              /* 破坏性操作收进「更多」，顶栏不留孤立红色图标（单色原则） */
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" title="更多操作" aria-label="更多操作">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />移入垃圾箱
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {editing ? (
        <section className="mx-auto w-full max-w-[760px]">
          <div className="space-y-4">
            <h1 className="text-xl font-semibold leading-7">{isNew ? "新建复盘" : "编辑复盘"}</h1>
            <div className="space-y-2">
              <Label htmlFor="type">类型</Label>
              <Select value={lessonType} onValueChange={(v: LessonType) => setLessonType(v)}>
                <SelectTrigger id="type" aria-label="复盘类型">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LESSON_TYPE_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>
                      {cfg.icon} {cfg.label} — {cfg.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">标题</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="给这条复盘起个标题..."
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">内容</Label>
              <Textarea
                id="content"
                value={contentText}
                onChange={(e) => setContentText(e.target.value)}
                placeholder="写下你的收获、反思、经验教训或灵感想法...\n\n用空行分段"
                rows={16}
                className="resize-y min-h-[320px] text-base leading-relaxed"
              />
            </div>

            <div className="space-y-2">
              <Label>标签</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {selectedTags.length > 0 && selectedTags.map((t) => (
                  <TagBadge key={t.id} tag={{ id: t.id, name: t.name, color: t.color }} onRemove={() => {
                    setSelectedTags(prev => prev.filter(x => x.id !== t.id));
                  }} />
                ))}
                <TagSelector
                  selected={selectedTags}
                  options={allTags}
                  onChange={handleTagChange}
                  triggerLabel={selectedTags.length > 0 ? "添加" : "添加标签"}
                />
              </div>
              {tagsLoadError && (
                <div className="flex flex-wrap items-center gap-2" role="alert">
                  <span className="text-xs text-destructive">
                    {LESSON_TAGS_LOAD_ERROR_MESSAGE}，保存时不会改动已有标签
                  </span>
                  <Button variant="outline" size="sm" onClick={() => fetchLesson()}>
                    重试
                  </Button>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>关联任务</Label>
                <Select value={linkTaskId} onValueChange={setLinkTaskId}>
                  <SelectTrigger aria-label="关联任务">
                    <SelectValue placeholder="无" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">无</SelectItem>
                    {tasks.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <CheckCircle2 className="inline h-3 w-3 mr-1" />
                        {(t.title || "未命名").slice(0, 30)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>关联阅读</Label>
                <Select value={linkReadingId} onValueChange={setLinkReadingId}>
                  <SelectTrigger aria-label="关联阅读">
                    <SelectValue placeholder="无" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">无</SelectItem>
                    {readingItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {(item.title || item.url).slice(0, 30)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>关联笔记</Label>
                <Select value={linkNoteId} onValueChange={setLinkNoteId}>
                  <SelectTrigger aria-label="关联笔记">
                    <SelectValue placeholder="无" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">无</SelectItem>
                    {notes.map((note) => (
                      <SelectItem key={note.id} value={note.id}>
                        {(note.title || "无标题").slice(0, 30)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => isNew ? router.push("/tasks/lessons") : setEditing(false)} disabled={saving}>
                取消
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                {isNew ? "创建" : "保存"}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <article className="mx-auto w-full max-w-[760px] space-y-5">
          <header className="space-y-3">
            <div className="flex items-start gap-3">
              <span className={cn("text-2xl", typeConfig.color)}>{typeConfig.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground mb-1">{typeConfig.label}</div>
                <h1 className="text-xl font-semibold leading-7">{title || "未命名复盘"}</h1>
              </div>
            </div>
            {loadedTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-2">
                {loadedTags.map((tag) => (
                  <TagBadge key={tag.id} tag={tag} />
                ))}
              </div>
            )}
            {tagsLoadError && (
              <div className="flex flex-wrap items-center gap-2" role="alert">
                <span className="text-xs text-destructive">{LESSON_TAGS_LOAD_ERROR_MESSAGE}</span>
                <Button variant="outline" size="sm" onClick={() => fetchLesson()}>
                  重试
                </Button>
              </div>
            )}
          </header>
          <div className="space-y-4">
            {contentText ? (
              <div className="text-foreground">
                {formatContentText(contentText)}
              </div>
            ) : (
              <p className="text-muted-foreground italic">（无内容）</p>
            )}

            {(linkedTask || linkedReading || linkedNote) && (
              <div className="border-t pt-4 space-y-2">
                <div className="text-xs text-muted-foreground font-medium">关联内容</div>
                <div className="flex flex-wrap gap-2">
                  {linkedTask && (
                    <Link href={`/tasks`} className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {linkedTask.title}
                    </Link>
                  )}
                  {linkedReading && (
                    <Link href={`/library/${linkedReading.id}`} className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                      <BookOpen className="h-3.5 w-3.5" />
                      {linkedReading.title || linkedReading.url}
                    </Link>
                  )}
                  {linkedNote && (
                    <Link href={`/notes/${linkedNote.id}`} className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                      <FileText className="h-3.5 w-3.5" />
                      {linkedNote.title || "无标题笔记"}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
