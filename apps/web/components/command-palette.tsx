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
} from "lucide-react";
import { TaskDialog } from "@/components/tasks/task-dialog";
import type { Task, ReadingItem, Note, Lesson } from "@organize/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type SearchResult = {
  type: "reading" | "note" | "task" | "lesson";
  item: ReadingItem | Note | Task | Lesson;
};

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

function highlightText(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-bold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [submittingLink, setSubmittingLink] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

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
      return;
    }

    setLoading(true);
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

        const readingMatches = (mockDb.reading_items as ReadingItem[])
          .filter((item) =>
            item.user_id === user.id &&
            ((item.title && item.title.toLowerCase().includes(q)) ||
              (item.excerpt && item.excerpt.toLowerCase().includes(q)))
          )
          .slice(0, 5)
          .map((item) => ({ type: "reading" as const, item }));

        const noteMatches = (mockDb.notes as Note[])
          .filter((note) =>
            note.user_id === user.id &&
            note.title && note.title.toLowerCase().includes(q)
          )
          .slice(0, 5)
          .map((item) => ({ type: "note" as const, item }));

        const taskMatches = (mockDb.tasks as Task[])
          .filter((task) =>
            task.user_id === user.id &&
            (task.title.toLowerCase().includes(q) ||
              (task.description && task.description.toLowerCase().includes(q)))
          )
          .slice(0, 5)
          .map((item) => ({ type: "task" as const, item }));

        const lessonMatches = (mockDb.lessons as Lesson[])
          .filter((lesson) => {
            if (lesson.user_id !== user.id) return false;
            const contentText = extractTextFromContent(lesson.content);
            return (
              (lesson.title && lesson.title.toLowerCase().includes(q)) ||
              contentText.toLowerCase().includes(q)
            );
          })
          .slice(0, 5)
          .map((item) => ({ type: "lesson" as const, item }));

        setResults([...readingMatches, ...noteMatches, ...taskMatches, ...lessonMatches]);
      } else {
        const [readingRes, notesRes, tasksRes, lessonsRes] = await Promise.all([
          supabase
            .from("reading_items")
            .select("id, title, excerpt")
            .eq("user_id", user.id)
            .or(`title.ilike.${searchTerm},excerpt.ilike.${searchTerm}`)
            .limit(5),
          supabase
            .from("notes")
            .select("id, title")
            .eq("user_id", user.id)
            .ilike("title", searchTerm)
            .limit(5),
          supabase
            .from("tasks")
            .select("id, title, description")
            .eq("user_id", user.id)
            .or(`title.ilike.${searchTerm},description.ilike.${searchTerm}`)
            .limit(5),
          supabase
            .from("lessons")
            .select("id, title, content")
            .eq("user_id", user.id)
            .ilike("title", searchTerm)
            .limit(5),
        ]);

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

        setResults([...readingMatches, ...noteMatches, ...taskMatches, ...lessonMatches]);
      }
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

  const renderSearchResultItem = (result: SearchResult, query: string) => {
    const Icon = getTypeIcon(result.type);
    const path = getItemPath(result.type, result.item.id);

    let title = "";
    let description = "";

    if (result.type === "reading") {
      const item = result.item as ReadingItem;
      title = item.title || item.url;
      description = item.excerpt || "";
    } else if (result.type === "note") {
      const item = result.item as Note;
      title = item.title || "无标题笔记";
      description = "";
    } else if (result.type === "task") {
      const item = result.item as Task;
      title = item.title;
      description = item.description || "";
    } else if (result.type === "lesson") {
      const item = result.item as Lesson;
      title = item.title || "无标题经验";
      description = extractTextFromContent(item.content);
    }

    return (
      <CommandItem
        key={`${result.type}-${result.item.id}`}
        value={`${getTypeLabel(result.type)} ${title}`}
        onSelect={() => handleSelect(path)}
        className="flex items-start gap-2 py-3"
      >
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">
            {highlightText(title, query)}
          </div>
          {description && (
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {truncate(description, 60)}
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-2">
          {getTypeLabel(result.type)}
        </span>
      </CommandItem>
    );
  };

  const groupedResults = {
    reading: results.filter((r) => r.type === "reading"),
    note: results.filter((r) => r.type === "note"),
    task: results.filter((r) => r.type === "task"),
    lesson: results.filter((r) => r.type === "lesson"),
  };

  const showSearch = searchQuery.length >= 2;

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
          {!showSearch && !linkInputOpen && (
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

          {showSearch && !linkInputOpen && (
            <>
              <CommandEmpty>
                {loading ? "搜索中..." : "没有找到结果"}
              </CommandEmpty>
              {groupedResults.reading.length > 0 && (
                <CommandGroup heading="阅读">
                  {groupedResults.reading.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
              {groupedResults.note.length > 0 && (
                <CommandGroup heading="笔记">
                  {groupedResults.note.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
              {groupedResults.task.length > 0 && (
                <CommandGroup heading="任务">
                  {groupedResults.task.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
              {groupedResults.lesson.length > 0 && (
                <CommandGroup heading="经验">
                  {groupedResults.lesson.map((r) => renderSearchResultItem(r, searchQuery))}
                </CommandGroup>
              )}
            </>
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
