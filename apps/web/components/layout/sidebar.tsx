"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Home,
  Library,
  FileText,
  Puzzle,
  Tag as TagIcon,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
  ListChecks,
  Star,
  Settings,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Loader2,
  Network,
  Feather,
  Users,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { useThemeColor } from "@/hooks/use-theme-color";
import { buildNoteTree, type NoteTreeNode } from "@/lib/notes/tree";
import { createNewNote, describeCreateNoteResult } from "@/lib/notes/create-note";
import { toast } from "@/hooks/use-toast";
import { useOpenTabsStore } from "@/lib/notes/open-tabs-store";
import { TaskSidebar, type SidebarSelection } from "@/components/tasks/task-sidebar";
import type { TaskList } from "@organize/shared";
import type { TaskScope } from "@/lib/tasks/repository";
import { useTaskRepository } from "@/lib/tasks/repository";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { useAllTags } from "@/components/tags/use-tags";
import { TagBadge } from "@/components/tags/tag-badge";
import { useHasSharedNotes } from "@/hooks/use-shared-notes";
import { useHasTeamWorkspaces } from "@/hooks/use-workspaces";

// 侧边栏可见的一级导航（D06 迁移表落地）：图谱收进笔记页工具行、插件收进设置页
// 「插件管理」入口——原一级入口移除，旧 URL 保留可达。
// 「经验」「标签」已降级：经验并入待办工作台，标签收进稍后读分组。
const navItems = [
  { href: "/", label: "工作台", icon: Home },
  { href: "/library", label: "稍后读", icon: Library },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/tasks", label: "待办", icon: ListChecks },
  { href: "/memos", label: "速记", icon: Feather },
  { href: "/trash", label: "垃圾箱", icon: Trash2 },
  { href: "/settings", label: "设置", icon: Settings },
];

// 辅助组（D06）：收藏夹移入此处，与「与我共享 / 协作空间」同组，插在「速记」之后。
const favoritesNavItem = { href: "/favorites", label: "收藏夹", icon: Star };

// 移动端顶栏位置名仍需识别已降级的一级页面（列表里没有，单独补齐）
const MOBILE_LABEL_EXTRA_ITEMS = [
  { href: "/lessons", label: "经验" },
  { href: "/tags", label: "标签" },
];

// 「与我共享」条件入口：有共享笔记才出现在「笔记」之后（useHasSharedNotes，mock 恒隐藏）
const sharedNavItem = { href: "/shared", label: "与我共享", icon: Users };

// 「协作空间」条件入口：有 team 空间才出现（useHasTeamWorkspaces，mock 恒隐藏），
// 紧跟「与我共享」之后——两个协作面一起成组
const spacesNavItem = { href: "/spaces", label: "协作空间", icon: UsersRound };

const TASK_NAV_EXPANDED_KEY = "organize-sidebar-task-nav-expanded";

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isTaskWorkspace = pathname === "/tasks" || pathname.startsWith("/tasks/");
  // 待办工作台内的全局工具页：不归属任何清单，侧边栏清单不高亮选中态
  const isGlobalTaskTool =
    pathname === "/tasks/countdown" ||
    pathname === "/tasks/search" ||
    pathname === "/tasks/lessons";
  const isTaskListContext = isTaskWorkspace && !isGlobalTaskTool;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  // 「最近」分组折叠态：折叠时显示 6 条，展开显示全部（12 条）；记忆到 localStorage
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const [noteTree, setNoteTree] = useState<NoteTreeNode[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  // 稍后读分组下的标签快捷列表：展开时拉取，标签增删经 organize:tags-changed 事件刷新
  const { tags: sidebarTags, refresh: refreshSidebarTags } = useAllTags();
  const supabase = useMemo(() => createClient(), []);
  const { tasks, lists, createList, updateList, deleteList, refetch: refetchTasks } = useTaskRepository();
  const recentNotes = useOpenTabsStore((state) => state.recents);
  useThemeColor();
  const hasSharedNotes = useHasSharedNotes();
  const hasTeamWorkspaces = useHasTeamWorkspaces();
// 一级导航 = 静态项 + 条件项（与我共享 / 协作空间，插在「笔记」之后成组；
// 两个条件入口各自探测，mock 后端恒隐藏）
const visibleNavItems = useMemo(() => {
  const items = [...navItems];
  let insertAt = 5; // 速记（index 4）之后 = 辅助组起点
  items.splice(insertAt, 0, favoritesNavItem);
  insertAt += 1;
  if (hasSharedNotes) {
    items.splice(insertAt, 0, sharedNavItem);
    insertAt += 1;
  }
  if (hasTeamWorkspaces) {
    items.splice(insertAt, 0, spacesNavItem);
  }
  return items;
}, [hasSharedNotes, hasTeamWorkspaces]);

  useEffect(() => {
    const stored = localStorage.getItem("organize-sidebar-collapsed") === "true";
    setCollapsed(stored);
    const storedNotesExpanded =
      localStorage.getItem("organize-sidebar-notes-expanded") === "true";
    setNotesExpanded(storedNotesExpanded || pathname.startsWith("/notes/"));
    const storedTasksExpanded = localStorage.getItem(TASK_NAV_EXPANDED_KEY) === "1";
    setTasksExpanded(storedTasksExpanded || isTaskWorkspace);
    setLibraryExpanded(
      localStorage.getItem("organize-sidebar-library-expanded") === "true" ||
        pathname.startsWith("/library")
    );
    setRecentsExpanded(localStorage.getItem("organize-sidebar-recents-expanded") === "true");
    document.documentElement.dataset.sidebarCollapsed = String(stored);
    return () => {
      delete document.documentElement.dataset.sidebarCollapsed;
    };
  }, [isTaskWorkspace, pathname]);

  const loadNoteTree = useCallback(async () => {
    setNotesLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("notes")
        .select("id, title, icon, parent_note_id, updated_at")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      setNoteTree(
        buildNoteTree(
          (data || []).map((note) => ({
            id: note.id,
            title: note.title || null,
            icon: note.icon || null,
            parent_note_id: note.parent_note_id || null,
            updated_at: note.updated_at,
          }))
        )
      );
    } finally {
      setNotesLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (notesExpanded) void loadNoteTree();
  }, [loadNoteTree, notesExpanded, pathname]);

  useEffect(() => {
    const reload = () => {
      if (notesExpanded) void loadNoteTree();
    };
    window.addEventListener("organize:notes-changed", reload);
    return () => window.removeEventListener("organize:notes-changed", reload);
  }, [loadNoteTree, notesExpanded]);

  useEffect(() => {
    const reloadTasks = () => void refetchTasks();
    window.addEventListener("organize:tasks-changed", reloadTasks);
    return () => window.removeEventListener("organize:tasks-changed", reloadTasks);
  }, [refetchTasks]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("organize-sidebar-collapsed", String(next));
    document.documentElement.dataset.sidebarCollapsed = String(next);
  };

  const toggleNotesExpanded = () => {
    const next = !notesExpanded;
    setNotesExpanded(next);
    localStorage.setItem("organize-sidebar-notes-expanded", String(next));
  };

  const toggleLibraryExpanded = () => {
    const next = !libraryExpanded;
    setLibraryExpanded(next);
    localStorage.setItem("organize-sidebar-library-expanded", String(next));
  };

  // 展开稍后读分组时拉标签；其他处增删标签后经事件同步
  useEffect(() => {
    if (libraryExpanded) void refreshSidebarTags();
  }, [libraryExpanded, refreshSidebarTags]);

  useEffect(() => {
    const reloadTags = () => {
      if (libraryExpanded) void refreshSidebarTags();
    };
    window.addEventListener("organize:tags-changed", reloadTags);
    return () => window.removeEventListener("organize:tags-changed", reloadTags);
  }, [libraryExpanded, refreshSidebarTags]);

  // 快捷列表按总使用量排序，最多展示 20 个，其余走「管理标签」
  const visibleSidebarTags = useMemo(() => {
    const usage = (t: (typeof sidebarTags)[number]) =>
      (t.reading_item_count || 0) + (t.note_count || 0) + (t.task_count || 0) + (t.lesson_count || 0);
    return [...sidebarTags]
      .sort((a, b) => usage(b) - usage(a) || a.name.localeCompare(b.name))
      .slice(0, 20);
  }, [sidebarTags]);

  const toggleTasksExpanded = () => {
    const next = !tasksExpanded;
    setTasksExpanded(next);
    localStorage.setItem(TASK_NAV_EXPANDED_KEY, next ? "1" : "0");
  };

  const taskSelection: SidebarSelection = useMemo(() => {
    const scope = (searchParams.get("scope") as TaskScope) || "all";
    return {
      scope,
      listId: scope === "list" ? searchParams.get("list") : null,
    };
  }, [searchParams]);

  // 移动端顶栏展示当前所在分区（Notion 移动端模式：汉堡 + 位置名），根路径回退到产品名
  const mobileSectionLabel = useMemo(() => {
    const match = [...navItems, sharedNavItem, spacesNavItem, ...MOBILE_LABEL_EXTRA_ITEMS]
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)));
    return match?.label ?? "Organize";
  }, [pathname]);

  const navigateToTasks = (selection: SidebarSelection) => {
    const params = new URLSearchParams();
    params.set("scope", selection.scope);
    if (selection.scope === "list" && selection.listId) {
      params.set("list", selection.listId);
    }
    setTasksExpanded(true);
    localStorage.setItem(TASK_NAV_EXPANDED_KEY, "1");
    setMobileOpen(false);
    router.push(`/tasks?${params.toString()}`);
  };

  const createTaskList = async () => {
    const name = (await showPrompt({ title: "新建清单", placeholder: "清单名称" }))?.trim();
    if (!name) return;
    await createList(name);
  };

  const renameTaskList = async (list: TaskList) => {
    const name = (await showPrompt({ title: "重命名清单", defaultValue: list.name }))?.trim();
    if (!name || name === list.name) return;
    await updateList(list.id, { name });
  };

  const deleteTaskList = async (list: TaskList) => {
    await deleteList(list.id);
  };

  const createNote = async () => {
    if (creatingNote) return;
    setCreatingNote(true);
    try {
      // N02：统一创建服务（离线入队返回 queued，客户端 id 即最终地址）
      const result = await createNewNote(supabase);
      if (result.status === "unauthenticated" || result.status === "failed") {
        toast({ title: describeCreateNoteResult(result), variant: "destructive" });
        return;
      }
      if (result.status === "queued") {
        toast({ title: describeCreateNoteResult(result) });
      }
      setNotesExpanded(true);
      localStorage.setItem("organize-sidebar-notes-expanded", "true");
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      setMobileOpen(false);
      router.push(`/notes/${result.noteId}`);
    } finally {
      setCreatingNote(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const NavContent = ({
    compact = false,
    collapsible = false,
    onClose,
  }: {
    compact?: boolean;
    collapsible?: boolean;
    onClose?: () => void;
  }) => (
    <div className="flex h-full flex-col">
      {/* 展开态：顶部搜索入口（打开全局命令面板）+ 品牌行，参考 Capacities 侧边栏 */}
      {!compact && (
        <div className="border-b px-3 pb-2.5 pt-3">
          <button
            type="button"
            onClick={() => {
              onClose?.();
              window.dispatchEvent(new CustomEvent("organize:command-palette"));
            }}
            title="搜索或访问（⌘K）"
            aria-label="搜索或访问"
            className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate text-left">搜索或访问</span>
            <kbd className="rounded border bg-background px-1 font-mono text-[10px]">⌘K</kbd>
          </button>
        </div>
      )}
      <div
        className={cn(
          "flex h-12 items-center border-b",
          compact ? "justify-center gap-0 px-0.5" : "justify-between px-4"
        )}
      >
        <Link
          href="/library"
          className={cn("flex items-center font-bold text-lg", compact ? "gap-0" : "gap-2")}
          title={compact ? "Organize" : undefined}
          aria-label={compact ? "Organize 首页" : undefined}
          onClick={onClose}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm shrink-0">
            O
          </span>
          {!compact && <span className="truncate">Organize</span>}
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="关闭菜单"
              aria-label="关闭菜单"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {!compact && <ThemeToggle />}
          {collapsible && !onClose && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className={cn(
                "rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                compact ? "p-1.5" : "p-2"
              )}
              title={compact ? "展开侧边栏" : "收起侧边栏"}
              aria-label={compact ? "展开侧边栏" : "收起侧边栏"}
            >
              {compact
                ? <PanelLeftOpen className="h-4 w-4" />
                : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      <nav className={cn("flex-1 space-y-1 overflow-y-auto", compact ? "px-2 py-3" : "p-3")}>
        {/* 最近打开的笔记（来自标签页 store 的访问记录）：折叠显示 6 条，展开 12 条 */}
        {!compact && recentNotes.length > 0 && (
          <div className="pb-2">
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded px-1 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                const next = !recentsExpanded;
                setRecentsExpanded(next);
                localStorage.setItem("organize-sidebar-recents-expanded", String(next));
              }}
              aria-expanded={recentsExpanded}
              title={recentsExpanded ? "收起最近列表" : "展开更多最近笔记"}
            >
              {recentsExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              最近
            </button>
            {recentNotes
              .slice(0, recentsExpanded ? 12 : 6)
              .map((item) => {
                const active = pathname === `/notes/${item.id}`;
                return (
                  <Link
                    key={item.id}
                    href={`/notes/${item.id}`}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                    title={item.title || "无标题笔记"}
                  >
                    <span className="shrink-0 text-[13px] leading-none">
                      {item.icon || "📄"}
                    </span>
                    <span className="truncate">{item.title || "无标题笔记"}</span>
                  </Link>
                );
              })}
            <div className="mt-2 border-t" />
          </div>
        )}
        {visibleNavItems.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
          if (item.href === "/library" && !compact) {
            // 稍后读分组：主体入口 + 可展开的标签快捷列表（点标签 = 带筛选进稍后读）
            const activeTagId = searchParams.get("tags");
            return (
              <div key={item.href}>
                <div
                  className={cn(
                    "group flex min-w-0 items-center rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Link
                    href="/library"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3"
                  >
                    <Library className="h-4 w-4 shrink-0" />
                    <span className="truncate">稍后读</span>
                  </Link>
                  <button
                    type="button"
                    className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-background/20"
                    title={libraryExpanded ? "收起标签列表" : "展开标签列表"}
                    aria-label={libraryExpanded ? "收起标签列表" : "展开标签列表"}
                    aria-expanded={libraryExpanded}
                    onClick={toggleLibraryExpanded}
                  >
                    {libraryExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                {libraryExpanded && (
                  <div className="mt-1 px-2">
                    {visibleSidebarTags.length === 0 ? (
                      <p className="px-3 py-1.5 text-sm text-muted-foreground">还没有标签</p>
                    ) : (
                      visibleSidebarTags.map((tag) => {
                        const tagActive = pathname.startsWith("/library") && activeTagId === tag.id;
                        return (
                          <Link
                            key={tag.id}
                            href={`/library?tags=${tag.id}`}
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                              "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                              tagActive
                                ? "bg-primary/10 font-medium text-primary"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            )}
                            title={`${tag.name}（文章 ${tag.reading_item_count || 0} · 笔记 ${tag.note_count || 0}）`}
                          >
                            <TagBadge tag={tag} size="sm" />
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                              {tag.reading_item_count || 0}
                            </span>
                          </Link>
                        );
                      })
                    )}
                    <Link
                      href="/tags"
                      onClick={() => setMobileOpen(false)}
                      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="管理全部标签（含笔记 / 任务标签）"
                    >
                      <TagIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">管理标签</span>
                    </Link>
                  </div>
                )}
              </div>
            );
          }
          if (item.href === "/tasks" && !compact) {
            return (
              <div key={item.href}>
                <div
                  className={cn(
                    "group flex min-w-0 items-center rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Link
                    href="/tasks?scope=all"
                    onClick={() => {
                      setTasksExpanded(true);
                      localStorage.setItem(TASK_NAV_EXPANDED_KEY, "1");
                      setMobileOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3"
                  >
                    <ListChecks className="h-4 w-4 shrink-0" />
                    <span className="truncate">待办</span>
                  </Link>
                  <button
                    type="button"
                    className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-background/20"
                    title={tasksExpanded ? "收起待办列表" : "展开待办列表"}
                    aria-label={tasksExpanded ? "收起待办列表" : "展开待办列表"}
                    aria-expanded={tasksExpanded}
                    onClick={toggleTasksExpanded}
                  >
                    {tasksExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                {tasksExpanded && (
                  <TaskSidebar
                    lists={lists}
                    tasks={tasks}
                    selection={taskSelection}
                    active={isTaskListContext}
                    hideHeading
                    onSelect={navigateToTasks}
                    onCreateList={() => void createTaskList()}
                    onRenameList={(list) => void renameTaskList(list)}
                    onDeleteList={(list) => void deleteTaskList(list)}
                  />
                )}
              </div>
            );
          }
          if (item.href === "/notes" && !compact) {
            return (
              <div key={item.href}>
                <div
                  className={cn(
                    "group flex min-w-0 items-center rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Link
                    href="/notes"
                    onClick={() => setMobileOpen(false)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3"
                  >
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="truncate">笔记</span>
                  </Link>
                  <button
                    type="button"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-background/20"
                    title="快速新建笔记"
                    aria-label="快速新建笔记"
                    onClick={() => void createNote()}
                    disabled={creatingNote}
                  >
                    {creatingNote ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-background/20"
                    title={notesExpanded ? "收起笔记列表" : "展开笔记列表"}
                    aria-label={notesExpanded ? "收起笔记列表" : "展开笔记列表"}
                    aria-expanded={notesExpanded}
                    onClick={toggleNotesExpanded}
                  >
                    {notesExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                {notesExpanded && (
                  <div className="mt-1 px-2">
                    {notesLoading && noteTree.length === 0 ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        加载笔记...
                      </div>
                    ) : (
                      <SidebarNoteTree
                        nodes={noteTree}
                        pathname={pathname}
                        onNavigate={() => setMobileOpen(false)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              title={compact ? item.label : undefined}
              aria-label={compact ? item.label : undefined}
              className={cn(
                "flex items-center rounded-md py-2 text-sm font-medium transition-colors min-w-0",
                compact ? "justify-center px-2" : "gap-3 px-3",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!compact && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={cn("border-t", compact ? "p-2" : "p-3")}>
        {/* 折叠模式下顶栏放不下主题按钮，保留在底部；展开时顶栏已有，不重复 */}
        {compact && (
          <div className="mb-2 flex justify-center">
            <ThemeToggle />
          </div>
        )}
        <Button
          variant="ghost"
          size={compact ? "icon" : "default"}
          className={cn(
            "text-muted-foreground",
            compact ? "w-full justify-center" : "w-full justify-start gap-3"
          )}
          onClick={handleLogout}
          title={compact ? "退出登录" : undefined}
          aria-label={compact ? "退出登录" : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!compact && <span className="truncate">退出登录</span>}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* 桌面端侧边栏 */}
      <aside className="organize-sidebar-desktop hidden transition-[width] duration-200 md:fixed md:inset-y-0 md:flex md:flex-col md:border-r md:bg-sidebar md:text-sidebar-foreground">
        <NavContent compact={collapsed} collapsible />
      </aside>

      {/* 移动端顶栏 */}
      <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center border-b bg-sidebar text-sidebar-foreground px-4 md:hidden pt-safe">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="ml-3 truncate font-bold text-lg">{mobileSectionLabel}</span>
      </header>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <DrawerEscapeHandler onClose={() => setMobileOpen(false)} />
      )}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/50 animate-in fade-in duration-200"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground shadow-lg animate-in slide-in-from-left duration-200 flex flex-col">
            <NavContent onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

function SidebarNoteTree({
  nodes,
  pathname,
  onNavigate,
}: {
  nodes: NoteTreeNode[];
  pathname: string;
  onNavigate: () => void;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNodes = (branch: NoteTreeNode[], depth: number): React.ReactNode => (
    <div className="flex flex-col gap-1">
      {branch.map((note) => {
        const hasChildren = note.children.length > 0;
        const childrenOpen = !collapsedIds.has(note.id);
        const active = pathname === `/notes/${note.id}`;
        return (
          <div key={note.id}>
            <div
              className={cn(
                "group flex min-w-0 items-center rounded-md text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              style={{ paddingLeft: `${8 + Math.min(depth, 6) * 14}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-background/50"
                  onClick={() => toggle(note.id)}
                  aria-label={childrenOpen ? "收起子页面" : "展开子页面"}
                  aria-expanded={childrenOpen}
                >
                  {childrenOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="h-6 w-6 shrink-0" />
              )}
              <Link
                href={`/notes/${note.id}`}
                onClick={onNavigate}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2"
                title={note.title || "无标题笔记"}
              >
                <span className="shrink-0">{note.icon || "📄"}</span>
                <span className="truncate">{note.title || "无标题笔记"}</span>
              </Link>
            </div>
            {hasChildren && childrenOpen && renderNodes(note.children, depth + 1)}
          </div>
        );
      })}
    </div>
  );

  if (nodes.length === 0) {
    return <p className="px-3 py-1.5 text-sm text-muted-foreground">还没有笔记</p>;
  }
  return <>{renderNodes(nodes, 0)}</>;
}

/** 抽屉打开期间按 Esc 关闭（D05 无障碍验收项；挂载在组件内以共享 mobileOpen 状态语义） */
function DrawerEscapeHandler({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return null;
}
