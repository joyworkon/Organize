"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Home,
  Inbox,
  Library,
  FileText,
  Puzzle,
  Tag as TagIcon,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ListChecks,
  Lightbulb,
  Star,
  Settings,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { ThemeColorPicker } from "@/components/theme-color-picker";
import { useThemeColor } from "@/hooks/use-theme-color";
import { buildNoteTree, type NoteTreeNode } from "@/lib/notes/tree";
import { TaskSidebar, type SidebarSelection } from "@/components/tasks/task-sidebar";
import type { TaskList } from "@organize/shared";
import type { TaskScope } from "@/lib/tasks/repository";
import { useTaskRepository } from "@/lib/tasks/repository";

const navItems = [
  { href: "/", label: "工作台", icon: Home },
  { href: "/inbox", label: "收集箱", icon: Inbox },
  { href: "/library", label: "阅读库", icon: Library },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/tasks", label: "待办", icon: ListChecks },
  { href: "/lessons", label: "经验", icon: Lightbulb },
  { href: "/tags", label: "标签", icon: TagIcon },
  { href: "/favorites", label: "收藏夹", icon: Star },
  { href: "/plugins", label: "插件", icon: Puzzle },
  { href: "/trash", label: "垃圾箱", icon: Trash2 },
  { href: "/settings", label: "设置", icon: Settings },
];

const TASK_NAV_EXPANDED_KEY = "organize-sidebar-task-nav-expanded";

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isTaskWorkspace = pathname === "/tasks" || pathname.startsWith("/tasks/");
  const isGlobalTaskTool = pathname === "/tasks/countdown" || pathname === "/tasks/search";
  const isTaskListContext = isTaskWorkspace && !isGlobalTaskTool;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [noteTree, setNoteTree] = useState<NoteTreeNode[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const { tasks, lists, createList, updateList, deleteList, refetch: refetchTasks } = useTaskRepository();
  useThemeColor();

  useEffect(() => {
    const stored = localStorage.getItem("organize-sidebar-collapsed") === "true";
    setCollapsed(stored);
    const storedNotesExpanded =
      localStorage.getItem("organize-sidebar-notes-expanded") === "true";
    setNotesExpanded(storedNotesExpanded || pathname.startsWith("/notes/"));
    const storedTasksExpanded = localStorage.getItem(TASK_NAV_EXPANDED_KEY) === "1";
    setTasksExpanded(storedTasksExpanded || isTaskWorkspace);
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
    const name = window.prompt("清单名称：")?.trim();
    if (!name) return;
    await createList(name);
  };

  const renameTaskList = async (list: TaskList) => {
    const name = window.prompt("清单新名称：", list.name)?.trim();
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title: "无标题笔记",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          icon: null,
          cover_url: null,
          cover_position: 50,
          parent_note_id: null,
        })
        .select()
        .single();
      if (error || !data) return;
      setNotesExpanded(true);
      localStorage.setItem("organize-sidebar-notes-expanded", "true");
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      setMobileOpen(false);
      router.push(`/notes/${data.id}`);
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
      <div
        className={cn(
          "flex h-14 items-center border-b",
          compact ? "justify-center gap-0 px-0.5" : "justify-between px-4"
        )}
      >
        <Link
          href="/inbox"
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
          {!compact && !onClose && <ThemeToggle />}
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
        {navItems.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
          if (item.href === "/tasks" && !compact) {
            return (
              <div key={item.href}>
                <div
                  className={cn(
                    "group flex min-w-0 items-center rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
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
                      ? "bg-primary text-primary-foreground"
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
                  <div className="mt-1">
                    {notesLoading && noteTree.length === 0 ? (
                      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
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
                  ? "bg-primary text-primary-foreground"
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
        {compact ? (
          <div className="flex flex-col items-center gap-1">
            <ThemeToggle />
            <ThemeColorPicker compact />
          </div>
        ) : onClose ? (
          <div className="mb-2 space-y-2">
            <div className="flex justify-start">
              <ThemeToggle />
            </div>
            <ThemeColorPicker />
          </div>
        ) : (
          <div className="mb-2">
            <ThemeColorPicker />
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
      <aside className="organize-sidebar-desktop hidden transition-[width] duration-200 md:fixed md:inset-y-0 md:flex md:flex-col md:border-r md:bg-card">
        <NavContent compact={collapsed} collapsible />
      </aside>

      {/* 移动端顶栏 */}
      <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center border-b bg-card px-4 md:hidden pt-safe">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="ml-3 font-bold text-lg">Organize</span>
      </header>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/50 animate-in fade-in duration-200"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-card shadow-lg animate-in slide-in-from-left duration-200 flex flex-col">
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

  const renderNodes = (branch: NoteTreeNode[], depth: number): React.ReactNode =>
    branch.map((note) => {
      const hasChildren = note.children.length > 0;
      const childrenOpen = !collapsedIds.has(note.id);
      const active = pathname === `/notes/${note.id}`;
      return (
        <div key={note.id}>
          <div
            className={cn(
              "group flex min-w-0 items-center rounded-md text-xs",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
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
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>
            ) : (
              <span className="h-6 w-6 shrink-0" />
            )}
            <Link
              href={`/notes/${note.id}`}
              onClick={onNavigate}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2"
              title={note.title || "无标题笔记"}
            >
              <span className="shrink-0">{note.icon || "📄"}</span>
              <span className="truncate">{note.title || "无标题笔记"}</span>
            </Link>
          </div>
          {hasChildren && childrenOpen && renderNodes(note.children, depth + 1)}
        </div>
      );
    });

  if (nodes.length === 0) {
    return <p className="px-4 py-2 text-xs text-muted-foreground">还没有笔记</p>;
  }
  return <>{renderNodes(nodes, 0)}</>;
}
