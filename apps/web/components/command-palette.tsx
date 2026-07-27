"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Home,
  Inbox,
  BookOpen,
  FileText,
  ListChecks,
  Lightbulb,
  Tag,
  BarChart3,
  Puzzle,
  Plus,
  Link as LinkIcon,
  FilePlus,
  BookOpenCheck,
  CheckSquare,
  StickyNote,
  Sparkles,
  Search as SearchIcon,
  Clock,
  X,
  HelpCircle,
  Settings,
} from "lucide-react";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { resetOnboarding } from "@/components/onboarding";
import type { Task, ReadingItem, Note, Lesson, Tag as TagType, TaskStatus, LessonType } from "@organize/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type SearchResult = {
  type: "reading" | "note" | "task" | "lesson" | "tag";
  item: ReadingItem | Note | Task | Lesson | TagType;
};

type SearchCounts = {
  reading: number;
  note: number;
  task: number;
  lesson: number;
  tag: number;
};

const RECENT_SEARCHES_KEY = "organize:recent-searches";
const MAX_RECENT_SEARCHES = 5;
const SEARCH_LIMIT = 8;

const NAV_ITEMS = [
  { label: "首页", path: "/", icon: Home, shortcut: "G H" },
  { label: "收集箱", path: "/inbox", icon: Inbox, shortcut: "G I" },
  { label: "阅读库", path: "/library", icon: BookOpen, shortcut: "G L" },
  { label: "笔记", path: "/notes", icon: FileText, shortcut: "G N" },
  { label: "待办", path: "/tasks", icon: ListChecks, shortcut: "G D" },
  { label: "经验", path: "/lessons", icon: Lightbulb, shortcut: "G E" },
  { label: "标签", path: "/tags", icon: Tag, shortcut: "G T" },
  { label: "统计", path: "/stats", icon: BarChart3, shortcut: "G S" },
  { label: "插件", path: "/plugins", icon: Puzzle, shortcut: "G P" },
  { label: "设置", path: "/settings", icon: Settings, shortcut: "" },
];

function getTypeIcon(type: SearchResult["type"]) {
  switch (type) {
    case "reading":
      return BookOpenCheck;
    case "note":
      return StickyNote;
    case "task":
      return CheckSquare;
    case "lesson":
      return Sparkles;
    case "tag":
      return Tag;
  }
}

function getTypeLabel(type: SearchResult["type"]) {
  switch (type) {
    case "reading":
      return "阅读";
    case "note":
      return "笔记";
    case "task":
      return "任务";
    case "lesson":
      return "经验";
    case "tag":
      return "标签";
  }
}

function getItemPath(type: SearchResult["type"], id: string) {
  switch (type) {
    case "reading":
      return `/library/${id}`;
    case "note":
      return `/notes/${id}`;
    case "task":
      return `/tasks`;
    case "lesson":
      return `/lessons/${id}`;
    case "tag":
      return `/tags`;
  }
}

function extractTextFromContent(content: Record<string, unknown> | string | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  const texts: string[] = [];
  const traverse = (node: Record<string, unknown>) => {
    if (typeof node.text === "string") {
      texts.push(node.text);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        if (child && typeof child === "object") {
          traverse(child as Record<string, unknown>);
        }
      }
    }
  };
  traverse(content);
  return texts.join(" ");
}

function truncate(str: string, len: number) {
  if (str.length <= len) return str;
  return str.slice(0, len) + "...";
}

function getDomainFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days < 0) return "已逾期";
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days < 7) return `${days}天后`;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function getTaskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    todo: "待办",
    in_progress: "进行中",
    done: "已完成",
    cancelled: "已取消",
  };
  return labels[status];
}

function getLessonTypeLabel(type: LessonType): string {
  const labels: Record<LessonType, string> = {
    reflection: "复盘",
    lesson: "经验",
    insight: "灵感",
  };
  return labels[type];
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-900/40 text-inherit rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string) {
  if (typeof window === "undefined") return;
  try {
    const recent = getRecentSearches().filter((s) => s !== query);
    recent.unshift(query);
    const trimmed = recent.slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

function clearRecentSearches() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(RECENT_SEARCHES_KEY);
}

export function CommandPalette() {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [counts, setCounts] = useState<SearchCounts>({
    reading: 0,
    note: 0,
    task: 0,
    lesson: 0,
    tag: 0,
  });
  const [loading, setLoading] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [submittingLink, setSubmittingLink] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const searchExecutedRef = useRef(false);

  const isMockMode = process.env.NEXT_PUBLIC_MOCK_BACKEND === "true";

  useHotkey([
    {
      key: "k",
      metaKey: true,
      handler: () => setOpen((prev) => !prev),
      allowInInput: false,
    },
    {
      key: "k",
      ctrlKey: true,
      handler: () => setOpen((prev) => !prev),
      allowInInput: false,
    },
  ]);

  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setResults([]);
      setLinkInputOpen(false);
      setLinkUrl("");
      setCounts({ reading: 0, note: 0, task: 0, lesson: 0, tag: 0 });
      setRecentSearches(getRecentSearches());
      searchExecutedRef.current = false;
    }
  }, [open]);

  const handleSaveTask = async (data: Partial<Task>, tagIds: string[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: inserted } = await supabase
      .from("tasks")
      .insert({ ...data, user_id: user.id })
      .select("id")
      .single();

    if (tagIds.length > 0 && inserted) {
      const links = tagIds.map((tagId) => ({ task_id: inserted.id, tag_id: tagId }));
      await supabase.from("task_tags").insert(links);
    }

    toast({ title: "任务已创建" });
    setTaskDialogOpen(false);
    setOpen(false);
  };

  const handlePasteLink = async () => {
    if (!linkUrl.trim()) return;
    setSubmittingLink(true);
    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkUrl.trim() }),
      });

      if (!response.ok) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("reading_items").insert({
            user_id: user.id,
            url: linkUrl.trim(),
            title: linkUrl.trim(),
            reading_status: "unread",
            reading_progress: 0,
          });
        }
      }

      toast({ title: "链接已添加到收集箱" });
      setLinkInputOpen(false);
      setLinkUrl("");
      setOpen(false);
      router.push("/inbox");
    } catch {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("reading_items").insert({
          user_id: user.id,
          url: linkUrl.trim(),
          title: linkUrl.trim(),
          reading_status: "unread",
          reading_progress: 0,
        });
      }
      toast({ title: "链接已添加到收集箱" });
      setLinkInputOpen(false);
      setLinkUrl("");
      setOpen(false);
      router.push("/inbox");
    } finally {
      setSubmittingLink(false);
    }
  };

  const performSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setResults([]);
      setCounts({ reading: 0, note: 0, task: 0, lesson: 0, tag: 0 });
      searchExecutedRef.current = false;
      return;
    }

    setLoading(true);
    searchExecutedRef.current = true;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setResults([]);
        return;
      }

      const searchTerm = `%${query}%`;

      if (isMockMode) {
        const { mockDb } = await import("@/lib/supabase/mock-data");
        const q = query.toLowerCase();

        const readingAll = (mockDb.reading_items as ReadingItem[])
          .filter((item) =>
            item.user_id === user.id &&
            ((item.title && item.title.toLowerCase().includes(q)) ||
              (item.excerpt && item.excerpt.toLowerCase().includes(q)))
          );

        const noteAll = (mockDb.notes as Note[])
          .filter((note) =>
            note.user_id === user.id &&
            note.title && note.title.toLowerCase().includes(q)
          );

        const taskAll = (mockDb.tasks as Task[])
          .filter((task) =>
            task.user_id === user.id &&
            (task.title.toLowerCase().includes(q) ||
              (task.description && task.description.toLowerCase().includes(q)))
          );

        const lessonAll = (mockDb.lessons as Lesson[])
          .filter((lesson) => {
            if (lesson.user_id !== user.id) return false;
            const contentText = extractTextFromContent(lesson.content);
            return (
              (lesson.title && lesson.title.toLowerCase().includes(q)) ||
              contentText.toLowerCase().includes(q)
            );
          });

        const tagAll: TagType[] = [];

        setCounts({
          reading: readingAll.length,
          note: noteAll.length,
          task: taskAll.length,
          lesson: lessonAll.length,
          tag: tagAll.length,
        });

        const readingMatches = readingAll.slice(0, SEARCH_LIMIT).map((item) => ({ type: "reading" as const, item }));
        const noteMatches = noteAll.slice(0, SEARCH_LIMIT).map((item) => ({ type: "note" as const, item }));
        const taskMatches = taskAll.slice(0, SEARCH_LIMIT).map((item) => ({ type: "task" as const, item }));
        const lessonMatches = lessonAll.slice(0, SEARCH_LIMIT).map((item) => ({ type: "lesson" as const, item }));
        const tagMatches = tagAll.slice(0, SEARCH_LIMIT).map((item) => ({ type: "tag" as const, item }));

        setResults([...readingMatches, ...noteMatches, ...taskMatches, ...lessonMatches, ...tagMatches]);
      } else {
        const [readingRes, notesRes, tasksRes, lessonsRes, tagsRes] = await Promise.all([
          supabase
            .from("reading_items")
            .select("id, url, title, excerpt", { count: "exact" })
            .eq("user_id", user.id)
            .or(`title.ilike.${searchTerm},excerpt.ilike.${searchTerm}`)
            .limit(SEARCH_LIMIT),
          supabase
            .from("notes")
            .select("id, title, content", { count: "exact" })
            .eq("user_id", user.id)
            .ilike("title", searchTerm)
            .limit(SEARCH_LIMIT),
          supabase
            .from("tasks")
            .select("id, title, description, status, due_date", { count: "exact" })
            .eq("user_id", user.id)
            .or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`)
            .limit(SEARCH_LIMIT),
          supabase
            .from("lessons")
            .select("id, title, content, lesson_type", { count: "exact" })
            .eq("user_id", user.id)
            .ilike("title", searchTerm)
            .limit(SEARCH_LIMIT),
          supabase
            .from("tags")
            .select("id, name, color", { count: "exact" })
            .eq("user_id", user.id)
            .ilike("name", searchTerm)
            .limit(SEARCH_LIMIT),
        ]);

        setCounts({
          reading: readingRes.count || 0,
          note: notesRes.count || 0,
          task: tasksRes.count || 0,
          lesson: lessonsRes.count || 0,
          tag: tagsRes.count || 0,
        });

        const readingMatches: SearchResult[] = (readingRes.data || []).map((item) => ({
          type: "reading",
          item: item as ReadingItem,
        }));

        const noteMatches: SearchResult[] = (notesRes.data || []).map((item) => ({
          type: "note",
          item: item as Note,
        }));

        const taskMatches: SearchResult[] = (tasksRes.data || []).map((item) => ({
          type: "task",
          item: item as Task,
        }));

        const lessonMatches: SearchResult[] = (lessonsRes.data || []).map((item) => ({
          type: "lesson",
          item: item as Lesson,
        }));

        const tagMatches: SearchResult[] = (tagsRes.data || []).map((item) => ({
          type: "tag",
          item: item as TagType,
        }));

        setResults([...readingMatches, ...noteMatches, ...taskMatches, ...lessonMatches, ...tagMatches]);
      }

      saveRecentSearch(query);
      setRecentSearches(getRecentSearches());
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, isMockMode]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, performSearch]);

  const handleSelect = (path: string) => {
    setOpen(false);
    router.push(path);
  };

  const handleTagSelect = (tag: TagType) => {
    setOpen(false);
    router.push(`/tags?tag=${tag.id}`);
  };

  const handleRecentSearchClick = (query: string) => {
    setSearchQuery(query);
  };

  const handleClearRecentSearches = () => {
    clearRecentSearches();
    setRecentSearches([]);
    toast({ title: "已清除最近搜索" });
  };

  const renderSearchResultItem = (result: SearchResult, query: string) => {
    const Icon = getTypeIcon(result.type);
    let path = getItemPath(result.type, result.item.id);
    let title = "";
    let subtitle = "";
    let meta = "";
    let isTag = false;

    if (result.type === "reading") {
      const item = result.item as ReadingItem;
      title = item.title || item.url;
      subtitle = getDomainFromUrl(item.url);
    } else if (result.type === "note") {
      const item = result.item as Note;
      title = item.title || "无标题笔记";
      const contentText = extractTextFromContent(item.content);
      subtitle = truncate(contentText, 100);
    } else if (result.type === "task") {
      const item = result.item as Task;
      title = item.title;
      const parts: string[] = [];
      parts.push(getTaskStatusLabel(item.status));
      if (item.due_date) {
        parts.push(formatDate(item.due_date));
      }
      subtitle = parts.join(" · ");
    } else if (result.type === "lesson") {
      const item = result.item as Lesson;
      title = item.title || "无标题经验";
      meta = getLessonTypeLabel(item.lesson_type);
    } else if (result.type === "tag") {
      const item = result.item as TagType;
      title = item.name;
      subtitle = "标签";
      isTag = true;
    }

    const onSelect = isTag
      ? () => handleTagSelect(result.item as TagType)
      : () => handleSelect(path);

    return (
      <CommandItem
        key={`${result.type}-${result.item.id}`}
        value={`${getTypeLabel(result.type)} ${title}`}
        onSelect={onSelect}
        className="flex items-start gap-2 py-3"
      >
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            <span>{highlightMatch(title, query)}</span>
            {meta && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                {meta}
              </span>
            )}
          </div>
          {subtitle && (
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">
          {getTypeLabel(result.type)}
        </span>
      </CommandItem>
    );
  };

  const renderMoreIndicator = (type: SearchResult["type"], total: number) => {
    if (total <= SEARCH_LIMIT) return null;
    return (
      <div className="text-xs text-muted-foreground px-2 py-1 pl-8">
        还有 {total - SEARCH_LIMIT} 条...
      </div>
    );
  };

  const groupedResults = {
    reading: results.filter((r) => r.type === "reading"),
    note: results.filter((r) => r.type === "note"),
    task: results.filter((r) => r.type === "task"),
    lesson: results.filter((r) => r.type === "lesson"),
    tag: results.filter((r) => r.type === "tag"),
  };

  const hasResults = results.length > 0;
  const showSearch = searchQuery.length >= 2;
  const showEmptyState = showSearch && !loading && !hasResults && searchExecutedRef.current;
  const showRecentSearches = !showSearch && !linkInputOpen && recentSearches.length > 0;

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="搜索或输入命令..."
          value={searchQuery}
          onValueChange={setSearchQuery}
          autoFocus
        />
        <CommandList>
          {!showSearch && !linkInputOpen && !showRecentSearches && (
            <>
              <CommandEmpty>没有找到结果</CommandEmpty>
              <CommandGroup heading="导航">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.path}
                      value={item.label}
                      onSelect={() => handleSelect(item.path)}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      <span>{item.label}</span>
                      <CommandShortcut>{item.shortcut}</CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="快速新建">
                <CommandItem onSelect={() => setTaskDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span>新建任务</span>
                </CommandItem>
                <CommandItem onSelect={() => setLinkInputOpen(true)}>
                  <LinkIcon className="mr-2 h-4 w-4" />
                  <span>粘贴链接到收集箱</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    toast({ title: "功能开发中", description: "笔记新建功能即将上线" });
                    setOpen(false);
                  }}
                >
                  <FilePlus className="mr-2 h-4 w-4" />
                  <span>新建笔记</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="帮助">
                <CommandItem onSelect={() => { resetOnboarding(); }}>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <span>重新查看引导</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}

          {showRecentSearches && (
            <>
              <CommandGroup heading="最近搜索">
                {recentSearches.map((query, idx) => (
                  <CommandItem
                    key={`${query}-${idx}`}
                    value={query}
                    onSelect={() => handleRecentSearchClick(query)}
                  >
                    <Clock className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{query}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <div className="px-2 py-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground h-8"
                  onClick={handleClearRecentSearches}
                >
                  <X className="mr-1.5 h-3 w-3" />
                  清除最近搜索
                </Button>
              </div>
              <CommandSeparator />
              <CommandGroup heading="导航">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.path}
                      value={item.label}
                      onSelect={() => handleSelect(item.path)}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      <span>{item.label}</span>
                      <CommandShortcut>{item.shortcut}</CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="快速新建">
                <CommandItem onSelect={() => setTaskDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span>新建任务</span>
                </CommandItem>
                <CommandItem onSelect={() => setLinkInputOpen(true)}>
                  <LinkIcon className="mr-2 h-4 w-4" />
                  <span>粘贴链接到收集箱</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    toast({ title: "功能开发中", description: "笔记新建功能即将上线" });
                    setOpen(false);
                  }}
                >
                  <FilePlus className="mr-2 h-4 w-4" />
                  <span>新建笔记</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="帮助">
                <CommandItem onSelect={() => { resetOnboarding(); }}>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <span>重新查看引导</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}

          {linkInputOpen && (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">粘贴链接到收集箱</span>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="输入 URL..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handlePasteLink();
                    } else if (e.key === "Escape") {
                      setLinkInputOpen(false);
                      setLinkUrl("");
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={handlePasteLink}
                  disabled={!linkUrl.trim() || submittingLink}
                >
                  {submittingLink ? "添加中..." : "添加"}
                </Button>
              </div>
            </div>
          )}

          {showEmptyState && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              <SearchIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>未找到相关内容</p>
              <p className="text-xs mt-1">尝试其他关键词或检查拼写</p>
            </div>
          )}

          {showSearch && !linkInputOpen && hasResults && (
            <>
              {groupedResults.tag.length > 0 && (
                <CommandGroup heading="标签">
                  {groupedResults.tag.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
              {renderMoreIndicator("tag", counts.tag)}
              {groupedResults.reading.length > 0 && (
                <CommandGroup heading="阅读">
                  {groupedResults.reading.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
              {renderMoreIndicator("reading", counts.reading)}
              {groupedResults.note.length > 0 && (
                <CommandGroup heading="笔记">
                  {groupedResults.note.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
              {renderMoreIndicator("note", counts.note)}
              {groupedResults.task.length > 0 && (
                <CommandGroup heading="任务">
                  {groupedResults.task.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
              {renderMoreIndicator("task", counts.task)}
              {groupedResults.lesson.length > 0 && (
                <CommandGroup heading="经验">
                  {groupedResults.lesson.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
              {renderMoreIndicator("lesson", counts.lesson)}
            </>
          )}

          {showSearch && loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              搜索中...
            </div>
          )}
        </CommandList>
      </CommandDialog>

      <TaskDialog
        open={taskDialogOpen}
        task={null}
        onClose={() => setTaskDialogOpen(false)}
        onSave={handleSaveTask}
      />
    </>
  );
}
