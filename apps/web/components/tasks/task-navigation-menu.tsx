"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  List,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import type { TaskList, TaskWithTags } from "@organize/shared";
import { cn } from "@/lib/utils";
import { useTaskRepository } from "@/lib/tasks/repository";
import type { SidebarSelection } from "@/components/tasks/task-sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TaskNavigationMenuProps {
  /** The control that opens the menu. It is kept outside the panel so callers
   * can use the same navigation on the dashboard and in the app sidebar. */
  trigger: ReactNode;
  /** Create a list from the same menu instead of navigating to a dead query. */
  onCreateList?: () => void | Promise<void>;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

function activeTaskCount(tasks: TaskWithTags[]): number {
  return tasks.filter(
    (task) => !task.deleted_at && task.status !== "done" && task.status !== "cancelled"
  ).length;
}

function listTaskCount(tasks: TaskWithTags[], listId: string): number {
  return tasks.filter(
    (task) =>
      !task.deleted_at &&
      task.status !== "done" &&
      task.status !== "cancelled" &&
      task.list_id === listId
  ).length;
}

function completedTaskCount(tasks: TaskWithTags[]): number {
  return tasks.filter((task) => !task.deleted_at && task.status === "done").length;
}

function taskUrl(selection: SidebarSelection): string {
  const params = new URLSearchParams();
  params.set("scope", selection.scope);
  if (selection.scope === "list" && selection.listId) params.set("list", selection.listId);
  return `/tasks?${params.toString()}`;
}

export function TaskNavigationMenu({
  trigger,
  onCreateList,
  align = "start",
  side = "bottom",
  className,
}: TaskNavigationMenuProps) {
  const router = useRouter();
  const { tasks, lists, loading, refetch } = useTaskRepository();
  const [open, setOpen] = useState(false);
  const allCount = useMemo(() => activeTaskCount(tasks), [tasks]);
  const completedCount = useMemo(() => completedTaskCount(tasks), [tasks]);

  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  const select = (selection: SidebarSelection) => {
    setOpen(false);
    router.push(taskUrl(selection));
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={8}
        className={cn(
          "w-[min(28rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border bg-card p-0 text-card-foreground shadow-xl",
          className
        )}
      >
        <div className="border-b px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#e7316d] text-xl font-bold text-white shadow-sm">
              O
            </span>
            <div className="min-w-0">
              <p className="text-xl font-semibold leading-none">待办</p>
              <p className="mt-1 text-xs text-muted-foreground">选择一个范围查看对应任务</p>
            </div>
          </div>
        </div>

        <div className="max-h-[min(70vh,34rem)] overflow-y-auto px-2 py-3">
          <div className="space-y-1">
            <TaskMenuItem
              icon={ListChecks}
              label="全部"
              count={allCount}
              onClick={() => select({ scope: "all", listId: null })}
            />
            <TaskMenuItem
              icon={Calendar}
              label="今天"
              onClick={() => select({ scope: "today", listId: null })}
            />
            <TaskMenuItem
              icon={CalendarDays}
              label="最近7天"
              onClick={() => select({ scope: "upcoming", listId: null })}
            />
          </div>

          <div className="mt-4 flex items-center justify-between px-3 pb-1">
            <span className="text-sm font-semibold text-muted-foreground">清单</span>
            <button
              type="button"
              aria-label="新建清单"
              onClick={() => {
                setOpen(false);
                if (onCreateList) void onCreateList();
                else router.push("/tasks");
              }}
              className="grid h-7 w-7 place-items-center rounded-md text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-1">
            {loading && lists.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">正在加载清单…</div>
            ) : lists.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">还没有清单</div>
            ) : (
              lists.map((list) => (
                <TaskListMenuItem
                  key={list.id}
                  list={list}
                  count={listTaskCount(tasks, list.id)}
                  onClick={() => select({ scope: "list", listId: list.id })}
                />
              ))
            )}
          </div>

          <div className="mt-4 border-t pt-2">
            <TaskMenuItem
              icon={CheckCircle2}
              label="已完成"
              count={completedCount}
              onClick={() => select({ scope: "completed", listId: null })}
            />
            <TaskMenuItem
              icon={Trash2}
              label="垃圾桶"
              onClick={() => select({ scope: "trash", listId: null })}
            />
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskMenuItem({
  icon: Icon,
  label,
  count,
  onClick,
}: {
  icon: typeof List;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-5 w-5 shrink-0 text-[#8a7d73] transition-colors group-hover:text-primary" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="tabular-nums text-sm text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

function TaskListMenuItem({
  list,
  count,
  onClick,
}: {
  list: TaskList;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <List className="h-5 w-5 shrink-0" style={{ color: list.color || undefined }} />
      <span className="min-w-0 flex-1 truncate">{list.name}</span>
      {count > 0 && <span className="tabular-nums text-sm text-muted-foreground">{count}</span>}
    </button>
  );
}
