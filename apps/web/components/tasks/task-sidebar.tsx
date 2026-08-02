"use client";
/**
 * 任务工作台侧栏（任务2）：清单/今天/7天/已完成/垃圾桶 + 计数。
 * 参照 notes 侧栏的展开模式。展开状态记忆到 localStorage。
 */
import { useState, useEffect, useMemo } from "react";
import {
  ListChecks, ChevronDown, ChevronRight, Plus,
  Calendar, CalendarDays, CheckCircle2, Trash2, List as ListIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskList, TaskWithTags } from "@organize/shared";
import type { TaskScope } from "@/lib/tasks/repository";

const EXPANDED_KEY = "organize-sidebar-tasks-expanded";

export interface SidebarSelection {
  scope: TaskScope;
  listId: string | null;
}

interface TaskSidebarProps {
  lists: TaskList[];
  tasks: TaskWithTags[];
  selection: SidebarSelection;
  onSelect: (sel: SidebarSelection) => void;
  onCreateList: () => void;
  onRenameList?: (list: TaskList) => void;
  onDeleteList?: (list: TaskList) => void;
  hideHeading?: boolean;
  active?: boolean;
}

/** 导出日期判断纯函数供单测 */
export function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}
export function isUpcoming(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (d.getTime() - now.getTime()) / 86400000;
  // 今天算 upcoming（diff 可能为负的微秒级，用 -1 兜底）
  return diff >= -1 && diff <= 6;
}
export function isOverdue(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d < now && d.toDateString() !== now.toDateString();
}

export function TaskSidebar({ lists, tasks, selection, onSelect, onCreateList, onRenameList, onDeleteList, hideHeading = false, active = true }: TaskSidebarProps) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(EXPANDED_KEY);
    if (saved !== null) setExpanded(saved === "1");
  }, []);
  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(EXPANDED_KEY, next ? "1" : "0");
  };

  // 计数
  const activeTasks = tasks.filter((t) => !t.deleted_at && t.status !== "done" && t.status !== "cancelled");
  const todayCount = activeTasks.filter(
    (t) => isToday(t.schedule_start_at) || (isOverdue(t.schedule_start_at) && t.status === "todo") || isToday(t.due_date) || (isOverdue(t.due_date) && t.status === "todo")
  ).length;
  const upcomingCount = activeTasks.filter(
    (t) => isUpcoming(t.schedule_start_at) || isUpcoming(t.due_date)
  ).length;
  const completedCount = tasks.filter((t) => !t.deleted_at && t.status === "done").length;
  const trashCount = tasks.filter((t) => t.deleted_at).length;

  const listCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of activeTasks) {
      if (t.list_id) m.set(t.list_id, (m.get(t.list_id) || 0) + 1);
    }
    return m;
  }, [activeTasks]);

  const isSelected = (sel: SidebarSelection) =>
    active && selection.scope === sel.scope && selection.listId === sel.listId;

  const NavItem = ({ icon: Icon, label, count, sel, accent }: {
    icon: any; label: string; count?: number; sel: SidebarSelection; accent?: string;
  }) => (
    <button
      type="button"
      onClick={() => onSelect(sel)}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
        isSelected(sel)
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" style={accent ? { color: accent } : undefined} />
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      )}
    </button>
  );

  return (
    <div className="organize-task-sidebar flex flex-col gap-0.5 p-2 min-w-[200px] max-w-[240px]">
      {!hideHeading && (
        <div className="flex items-center gap-1 px-1 py-1.5">
          <button type="button" onClick={toggleExpanded} className="p-0.5 rounded hover:bg-muted" aria-label={expanded ? "收起待办导航" : "展开待办导航"}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <ListChecks className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">待办</span>
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-0.5">
          <NavItem icon={ListChecks} label="全部" count={activeTasks.length} sel={{ scope: "all", listId: null }} />
          <NavItem icon={Calendar} label="今天" count={todayCount} sel={{ scope: "today", listId: null }} />
          <NavItem icon={CalendarDays} label="最近7天" count={upcomingCount} sel={{ scope: "upcoming", listId: null }} />

          {/* 清单分组 */}
          <div className="mt-2 mb-1 px-3 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">清单</span>
            <button type="button" onClick={onCreateList} title="新建清单" className="p-0.5 rounded hover:bg-muted">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {lists.map((list) => (
            <div
              key={list.id}
              onContextMenu={(e) => {
                if (onRenameList || onDeleteList) {
                  e.preventDefault();
                  const action = window.prompt(`${list.name}\n\n输入 r 改名，d 删除：`);
                  if (action === "r" && onRenameList) onRenameList(list);
                  else if (action === "d" && onDeleteList) {
                    if (window.confirm(`删除清单「${list.name}」？清单内任务会移到未分类。`)) onDeleteList(list);
                  }
                }
              }}
            >
              <NavItem
                icon={ListIcon}
                label={list.name}
                count={listCounts.get(list.id) || 0}
                sel={{ scope: "list", listId: list.id }}
                accent={list.color || undefined}
              />
            </div>
          ))}

          <div className="mt-2 border-t pt-1">
            <NavItem icon={CheckCircle2} label="已完成" count={completedCount} sel={{ scope: "completed", listId: null }} />
            <NavItem icon={Trash2} label="垃圾桶" count={trashCount} sel={{ scope: "trash", listId: null }} />
          </div>
        </div>
      )}
    </div>
  );
}
