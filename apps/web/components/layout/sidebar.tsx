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
  Lightning,
  Users,
  UsersRound,
  LayoutGrid,
} from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ThemeToggle } from "./theme-toggle";
import { buildNoteTree, limitNoteRoots, type NoteTreeNode } from "@/lib/notes/tree";
import {
  nextSidebarNoteTreeAfterLoad,
  type SidebarNoteItem,
} from "@/lib/layout/sidebar-note-tree-load";
import {
  SIDEBAR_HAS_SHARED_NOTES_LOAD_ERROR_HINT,
  SIDEBAR_HAS_TEAM_WORKSPACES_LOAD_ERROR_HINT,
} from "@/lib/layout/sidebar-collab-presence-load";
import { useNoteGroups } from "@/hooks/use-note-groups";
import { UNGROUPED_KEY, moveNotesToGroup, notifyNoteGroupsChanged, shouldShowGroupsLoadError } from "@/lib/notes/groups";
import { useOnlineStatus } from "@/lib/offline/network";
import { NOTE_DRAG_MIME } from "@/components/notes/note-groups-bar";

/** 侧栏笔记列表默认只显示的顶层笔记数 */
const SIDEBAR_NOTES_LIMIT = 5;
const NOTES_SHOW_ALL_KEY = "organize-sidebar-notes-show-all";
import { createNewNote, describeCreateNoteResult } from "@/lib/notes/create-note";
import { toast } from "@/hooks/use-toast";
import { useOpenTabsStore } from "@/lib/notes/open-tabs-store";
import { TaskSidebar, type SidebarSelection } from "@/components/tasks/task-sidebar";
import type { TaskList } from "@organize/shared";
import type { TaskScope } from "@/lib/tasks/repository";
import { useTaskRepository } from "@/lib/tasks/repository";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { useAllTags } from "@/components/tags/use-tags";
import { tagsEmptyMessage } from "@/lib/tags/all-tags-load";
import { TagBadge } from "@/components/tags/tag-badge";
import { useHasSharedNotes } from "@/hooks/use-shared-notes";
import { useHasTeamWorkspaces } from "@/hooks/use-workspaces";

// 侧边栏可见的一级导航（D06 迁移表落地）：图谱收进笔记页页头「更多」菜单、插件收进设置页
// 「插件管理」入口——原一级入口移除，旧 URL 保留可达。
// 「经验」「标签」已降级：经验并入待办工作台，标签收进资料库分组。
// 阶段 C：「稍后读」「速记」融合为「资料库」（/library，?view=reading|memos 切换视图），
// 速记一级入口移除（/memos 重定向兼容），行内「+」移到资料库行（聚焦统一输入框）。
const navItems = [
  { href: "/", label: "工作台", icon: Home },
  { href: "/library", label: "资料库", icon: Library },
  { href: "/notes", label: "笔记", icon: FileText },
  // 构思画布（idea-canvas）：与笔记同级的一级入口（/canvas，规格 §1）
  { href: "/canvas", label: "构思画布", icon: LayoutGrid },
  { href: "/tasks", label: "待办", icon: ListChecks },
  { href: "/trash", label: "垃圾箱", icon: Trash2 },
  { href: "/settings", label: "设置", icon: Settings },
];

// 辅助组（D06）：收藏夹移入此处，与「与我共享 / 协作空间」同组，插在「资料库」之后。
const favoritesNavItem = { href: "/favorites", label: "收藏夹", icon: Star };

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
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const openSearchAfterCloseRef = useRef(false);
  useEffect(() => {
    const openNavigation = () => {
      menuTriggerRef.current = document.activeElement as HTMLElement | null;
      setMobileOpen(true);
    };
    window.addEventListener("organize:navigation", openNavigation);
    return () => window.removeEventListener("organize:navigation", openNavigation);
  }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname, searchParams]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("organize:navigation-state", { detail: { open: mobileOpen } }));
  }, [mobileOpen]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => { if (query.matches) setMobileOpen(false); };
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, []);
  const [collapsed, setCollapsed] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [noteTree, setNoteTree] = useState<NoteTreeNode[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  // 笔记树查询失败的诚实提示：从未成功时用提示+重试替代「还没有笔记」；曾成功时保留旧树再提示
  const [noteTreeError, setNoteTreeError] = useState<string | null>(null);
  const lastNoteRowsRef = useRef<SidebarNoteItem[] | null>(null);
  const [creatingNote, setCreatingNote] = useState(false);
  // 资料库分组下的标签快捷列表：展开时拉取，标签增删经 organize:tags-changed 事件刷新
  const { tags: sidebarTags, loadError: sidebarTagsLoadError, refresh: refreshSidebarTags } =
    useAllTags();
  const supabase = useMemo(() => createClient(), []);
  const { tasks, lists, createList, updateList, deleteList, refetch: refetchTasks } = useTaskRepository();
  const recentNotes = useOpenTabsStore((state) => state.recents);
  const {
    has: hasSharedNotes,
    loadError: sharedNotesLoadError,
    refresh: refreshSharedNotesPresence,
  } = useHasSharedNotes();
  const {
    has: hasTeamWorkspaces,
    loadError: teamWorkspacesLoadError,
    refresh: refreshTeamWorkspacesPresence,
  } = useHasTeamWorkspaces();
// 一级导航 = 静态项 + 条件项（与我共享 / 协作空间，插在「资料库」之后成组；
// 两个条件入口各自探测，mock 后端恒隐藏）
const visibleNavItems = useMemo(() => {
  const items = [...navItems];
  // 辅助组起点 = 「资料库」之后。用语义锚点定位（此前写死 index 5，
  // 新增一级入口后会挤进主组中间，把收藏夹推到锚点之前）
  let insertAt = navItems.findIndex((i) => i.href === "/library") + 1;
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
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, icon, parent_note_id, updated_at, is_pinned")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      const plan = nextSidebarNoteTreeAfterLoad({
        previous: lastNoteRowsRef.current,
        data,
        error,
      });
      setNoteTreeError(plan.loadError);
      if (plan.rows && !plan.loadError) {
        lastNoteRowsRef.current = plan.rows;
        setNoteTree(buildNoteTree(plan.rows));
      }
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

  // 树查询失败的一行小字提示 + 重试：树为空时替代「还没有笔记」，树非空时附在旧树下方
  const noteTreeErrorLine = noteTreeError && (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
      <span role="alert">{noteTreeError}</span>
      <button
        type="button"
        onClick={() => void loadNoteTree()}
        className="transition-colors hover:text-foreground"
      >
        重试
      </button>
    </div>
  );

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

  // 展开资料库分组时拉标签；其他处增删标签后经事件同步
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
    <div className="organize-sidebar-content flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "organize-sidebar-brand flex h-14 shrink-0 items-center",
          compact ? "justify-center gap-0 px-0.5" : "justify-between px-4"
        )}
      >
        <Link
          href="/"
          className={cn("flex items-center text-lg font-semibold", compact ? "hidden" : "gap-2")}
          title={compact ? "Cairn" : undefined}
          aria-label={compact ? "Cairn 首页" : undefined}
          onClick={onClose}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-foreground text-sm">
            C
          </span>
          {!compact && <span className="truncate">Cairn</span>}
        </Link>
        {/* -mr-0.5：让收起箭头图标中心与下方导航行尾按钮（笔记/待办箭头、速记闪电）同列 */}
        <div className="-mr-0.5 flex items-center gap-1 shrink-0">
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

      <div className={cn("organize-sidebar-search px-3 pb-3", compact && "px-2")}>
        <button
          type="button"
          onClick={() => {
            if (onClose) {
              openSearchAfterCloseRef.current = true;
              onClose();
            } else window.dispatchEvent(new CustomEvent("organize:command-palette"));
          }}
          title="搜索全部内容（⌘K）"
          aria-label="搜索全部内容"
          className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", compact && "justify-center px-0")}
        >
          <Search className="h-4 w-4 shrink-0" />
          {!compact && <><span className="flex-1 truncate text-left">搜索全部内容</span><kbd className="rounded border px-1 font-mono text-[10px]">⌘K</kbd></>}
        </button>
      </div>
      <nav aria-label="应用导航" className={cn("min-h-0 flex-1 space-y-1 overflow-y-auto", compact ? "px-2 pb-3" : "px-3 pb-3")}>

        {visibleNavItems.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
          if (item.href === "/library" && !compact) {
            // 资料库分组：主体入口 + 行内「+」（速记/链接/长文统一输入框）+ 可展开的标签快捷列表
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
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3"
                  >
                    <Library className="h-4 w-4 shrink-0" />
                    <span className="truncate">资料库</span>
                  </Link>
                  {/* 行内「+」（阶段 C 从速记行移入）：已在本页时聚焦统一输入框，
                      否则带 ?compose=1 过去（页面负责聚焦后抹参数） */}
                  <button
                    type="button"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-background/20"
                    title="快速记录"
                    aria-label="快速记录"
                    onClick={() => {
                      setMobileOpen(false);
                      if (pathname === "/library") {
                        window.dispatchEvent(new CustomEvent("organize:memo-compose"));
                        return;
                      }
                      router.push("/library?compose=1");
                    }}
                  >
                    <Lightning className="h-3.5 w-3.5" />
                  </button>
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
                      <p
                        className={cn(
                          "px-3 py-1.5 text-sm",
                          sidebarTagsLoadError ? "text-destructive" : "text-muted-foreground"
                        )}
                      >
                        {tagsEmptyMessage(sidebarTagsLoadError)}
                      </p>
                    ) : (
                      visibleSidebarTags.map((tag) => {
                        const tagActive = pathname.startsWith("/library") && activeTagId === tag.id;
                        return (
                          <Link
                            key={tag.id}
                            // 标签快捷列表语义 = 稍后读标签筛选（阶段 C 起带 view=reading 直达该视图）
                            href={`/library?view=reading&tags=${tag.id}`}
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                              "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                              tagActive
                                ? "bg-accent font-medium text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                            )}
                            title={`${tag.name}（文章 ${tag.reading_item_count || 0} · 笔记 ${tag.note_count || 0}）`}
                          >
                            <TagBadge tag={tag} size="sm" />
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
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
                    aria-current={isActive ? "page" : undefined}
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
                    aria-current={isActive ? "page" : undefined}
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
                {/* 侧栏只保留一处「最近」：笔记树收起时在笔记分组下显示最近打开的 5 篇，
                    展开树时由树替代——不再在导航顶部另起一个与树重复的「最近」列表 */}
                {!notesExpanded && recentNotes.length > 0 && (
                  <div className="mt-1 px-2" aria-label="最近打开的笔记" role="group">
                    {recentNotes.slice(0, 5).map((recent) => {
                      const active = pathname === `/notes/${recent.id}`;
                      return (
                        <Link
                          key={recent.id}
                          href={`/notes/${recent.id}`}
                          onClick={() => setMobileOpen(false)}
                          className={cn(
                            "flex min-w-0 items-center gap-2 rounded-md px-3 py-1 text-[13px] transition-colors",
                            active
                              ? "bg-accent font-medium text-accent-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                          title={recent.title || "无标题笔记"}
                        >
                          <span className="shrink-0 leading-none">{recent.icon || <FileText className="h-3.5 w-3.5" />}</span>
                          <span className="truncate">{recent.title || "无标题笔记"}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
                {notesExpanded && (
                  <div className="mt-1 px-2">
                    {notesLoading && noteTree.length === 0 ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        加载笔记...
                      </div>
                    ) : noteTreeError && noteTree.length === 0 ? (
                      noteTreeErrorLine
                    ) : (
                      <>
                        <SidebarGroupedNotes
                          nodes={noteTree}
                          pathname={pathname}
                          onNavigate={() => setMobileOpen(false)}
                        />
                        {noteTreeErrorLine}
                      </>
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
              aria-current={isActive ? "page" : undefined}
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
        {sharedNotesLoadError && (
          <div className="flex items-center gap-2 px-3 py-1 text-xs text-destructive">
            <span role="alert" className="min-w-0 flex-1">
              {SIDEBAR_HAS_SHARED_NOTES_LOAD_ERROR_HINT}
            </span>
            <button
              type="button"
              aria-label="重试与我共享状态读取"
              onClick={refreshSharedNotesPresence}
              className="shrink-0 transition-colors hover:text-foreground"
            >
              重试
            </button>
          </div>
        )}
        {teamWorkspacesLoadError && (
          <div className="flex items-center gap-2 px-3 py-1 text-xs text-destructive">
            <span role="alert" className="min-w-0 flex-1">
              {SIDEBAR_HAS_TEAM_WORKSPACES_LOAD_ERROR_HINT}
            </span>
            <button
              type="button"
              aria-label="重试协作空间状态读取"
              onClick={refreshTeamWorkspacesPresence}
              className="shrink-0 transition-colors hover:text-foreground"
            >
              重试
            </button>
          </div>
        )}
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

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent id="mobile-navigation-drawer" className="mobile-navigation-sheet" hideCloseButton onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (openSearchAfterCloseRef.current) {
            openSearchAfterCloseRef.current = false;
            // Search outlives this drawer, so carry its connected return target.
            window.dispatchEvent(new CustomEvent("organize:command-palette", {
              detail: { returnFocus: menuTriggerRef.current },
            }));
          } else if (menuTriggerRef.current?.isConnected) menuTriggerRef.current.focus();
        }}>
          <DialogHeader className="sr-only">
            <DialogTitle>应用导航</DialogTitle>
            <DialogDescription>工作区、资料标签、笔记目录、任务清单与应用设置</DialogDescription>
          </DialogHeader>
          <NavContent onClose={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

const GROUP_COLLAPSED_KEY = "organize-sidebar-note-groups-collapsed";

/**
 * 侧栏笔记：有分组时按「各分组 → 未分组」分段（按顶层笔记归组，子页面跟随父页面），
 * 每段各自「前 5 篇 + 查看更多」；分组标题可折叠（记住状态），也可以把侧栏里的笔记拖到分组标题上归类。
 */
function SidebarGroupedNotes({
  nodes,
  pathname,
  onNavigate,
}: {
  nodes: NoteTreeNode[];
  pathname: string;
  onNavigate: () => void;
}) {
  const { supabase, userId, groups, membership, loadError: groupsLoadError } = useNoteGroups();
  const online = useOnlineStatus();
  // 分组加载失败的一行小字提示：toast 会消失，侧栏静默显示旧分组等于掩盖失败
  const groupsLoadErrorLine = shouldShowGroupsLoadError(groupsLoadError, online) && (
    <p className="px-1.5 text-[11px] text-destructive" role="alert">
      分组加载失败
    </p>
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [dropKey, setDropKey] = useState<string | null>(null);
  useEffect(() => {
    try {
      setCollapsedGroups(new Set(JSON.parse(localStorage.getItem(GROUP_COLLAPSED_KEY) || "[]")));
    } catch {
      /* ignore */
    }
  }, []);
  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(GROUP_COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <>
        {groupsLoadErrorLine}
        <SidebarNoteTree nodes={nodes} pathname={pathname} onNavigate={onNavigate} />
      </>
    );
  }

  const sections = [
    ...groups.map((g) => ({ key: g.id, name: g.name, nodes: nodes.filter((n) => membership.get(n.id) === g.id) })),
    { key: UNGROUPED_KEY, name: "未分组", nodes: nodes.filter((n) => !membership.has(n.id)) },
  ];

  const drop = async (noteId: string, key: string) => {
    if (!userId) return;
    try {
      await moveNotesToGroup(supabase, userId, [noteId], key === UNGROUPED_KEY ? null : key);
      notifyNoteGroupsChanged();
    } catch {
      /* 失败时列表保持原样 */
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {groupsLoadErrorLine}
      {sections.map((section) => {
        const open = !collapsedGroups.has(section.key);
        return (
          <div key={section.key} data-sidebar-group={section.name}>
            <button
              type="button"
              onClick={() => toggleGroup(section.key)}
              aria-expanded={open}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(NOTE_DRAG_MIME)) return;
                event.preventDefault();
                setDropKey(section.key);
              }}
              onDragLeave={() => setDropKey((k) => (k === section.key ? null : k))}
              onDrop={(event) => {
                const noteId = event.dataTransfer.getData(NOTE_DRAG_MIME);
                setDropKey(null);
                if (noteId) {
                  event.preventDefault();
                  void drop(noteId, section.key);
                }
              }}
              className={cn(
                "flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                dropKey === section.key && "bg-primary/10 text-foreground ring-1 ring-primary"
              )}
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span className="min-w-0 flex-1 truncate text-left">{section.name}</span>
              <span className="text-[11px] font-normal">{section.nodes.length}</span>
            </button>
            {open && (
              <SidebarNoteTree
                nodes={section.nodes}
                pathname={pathname}
                onNavigate={onNavigate}
                showAllKey={`${NOTES_SHOW_ALL_KEY}:${section.key}`}
                emptyText="拖笔记到这里"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SidebarNoteTree({
  nodes,
  pathname,
  onNavigate,
  limit = SIDEBAR_NOTES_LIMIT,
  showAllKey = NOTES_SHOW_ALL_KEY,
  emptyText = "还没有笔记",
}: {
  nodes: NoteTreeNode[];
  pathname: string;
  onNavigate: () => void;
  /** 顶层最多显示几篇，其余收进「查看更多」 */
  limit?: number;
  /** 「查看更多」展开状态的 localStorage 键（每个列表各记各的） */
  showAllKey?: string;
  emptyText?: string;
}) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    try {
      setShowAll(localStorage.getItem(showAllKey) === "1");
    } catch {
      /* 存储不可用时按默认收起 */
    }
  }, [showAllKey]);
  const toggleShowAll = () => {
    setShowAll((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(showAllKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const activeId = pathname.startsWith("/notes/") ? pathname.slice("/notes/".length) : null;
  const { visible, hiddenCount } = limitNoteRoots(nodes, limit, activeId);
  const roots = showAll ? limitNoteRoots(nodes, Number.MAX_SAFE_INTEGER).visible : visible;

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
                  ? "bg-accent text-accent-foreground font-medium"
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
                onDragStart={(event) => event.dataTransfer.setData(NOTE_DRAG_MIME, note.id)}
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
    return <p className="px-3 py-1.5 text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <>
      {renderNodes(roots, 0)}
      {(hiddenCount > 0 || showAll) && nodes.length > limit && (
        <div className="mt-0.5 flex items-center justify-between gap-2 pl-[30px] pr-2">
          <button
            type="button"
            onClick={toggleShowAll}
            aria-expanded={showAll}
            className="py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showAll ? "收起" : `查看更多（${hiddenCount}）`}
          </button>
          <Link href="/notes" onClick={onNavigate} className="py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            全部笔记
          </Link>
        </div>
      )}
    </>
  );
}
