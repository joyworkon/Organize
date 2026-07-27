"use client";

import Link from "next/link";
import {
  Pin,
  CheckCircle2,
  MoreHorizontal,
  BookOpen,
  FileText,
  Clock,
  Trash2,
  Pencil,
  Check,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/tags/tag-badge";
import { cn } from "@/lib/utils";
import type { TaskWithTags, TaskStatus } from "@organize/shared";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  TASK_CATEGORY_CONFIG,
} from "@organize/shared";

interface TaskCardProps {
  task: TaskWithTags;
  onEdit?: (task: TaskWithTags) => void;
  onDelete?: (id: string) => void;
  onToggleStatus?: (id: string, status: TaskStatus) => void;
  onTogglePin?: (id: string, isPinned: boolean) => void;
  onComplete?: (task: TaskWithTags) => void;
}

export function TaskCard({
  task,
  onEdit,
  onDelete,
  onToggleStatus,
  onTogglePin,
  onComplete,
}: TaskCardProps) {
  const statusConfig = TASK_STATUS_CONFIG[task.status];
  const priorityConfig = TASK_PRIORITY_CONFIG[task.priority];
  const categoryConfig = TASK_CATEGORY_CONFIG[task.category];

  const isOverdue =
    task.due_date && task.status !== "done" && task.status !== "cancelled" && new Date(task.due_date) < new Date();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "今天到期";
    if (days === 1) return "明天到期";
    if (days === -1) return "昨天到期";
    if (days < 0) return `已逾期 ${Math.abs(days)} 天`;
    if (days <= 7) return `${days} 天后到期`;
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  const handleToggleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.status === "done") {
      onToggleStatus?.(task.id, "todo");
    } else if (onComplete) {
      onComplete(task);
    }
  };

  return (
    <Card
      className={cn(
        "group transition-colors duration-150 border-l-4 hover:bg-accent",
        task.is_pinned && "ring-1 ring-primary/20",
        isOverdue && "border-l-red-500",
        !isOverdue && task.status === "done" && "border-l-green-500",
        !isOverdue && task.status !== "done" && task.priority === "high" && "border-l-orange-500",
        !isOverdue && task.status !== "done" && task.priority === "medium" && "border-l-primary",
        !isOverdue && task.status !== "done" && task.priority === "low" && "border-l-muted"
      )}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <button
            onClick={handleToggleComplete}
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
              task.status === "done"
                ? "border-green-500 bg-green-500 text-white"
                : "border-muted-foreground/30 hover:border-primary"
            )}
          >
            {task.status === "done" && <Check className="h-3 w-3" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {task.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
                  <h3
                    className={cn(
                      "font-medium leading-tight",
                      task.status === "done" && "line-through text-muted-foreground"
                    )}
                  >
                    {task.title}
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <Badge
                    className={cn(
                      "text-[10px] px-1.5 py-0 font-medium",
                      task.status === "done"
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : task.status === "in_progress"
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {statusConfig.label}
                  </Badge>
                  <Badge
                    className={cn(
                      "text-[10px] px-1.5 py-0 font-medium",
                      task.priority === "high"
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : task.priority === "medium"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {priorityConfig.label}
                  </Badge>
                  <Badge className={cn("text-[10px] px-1.5 py-0 font-medium", categoryConfig.bg, categoryConfig.color)}>
                    {categoryConfig.icon} {categoryConfig.label}
                  </Badge>
                  {task.estimated_minutes && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {task.estimated_minutes}分
                      {task.actual_minutes ? ` / ${task.actual_minutes}分` : ""}
                    </span>
                  )}
                </div>

                {task.description && (
                  <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                    {task.description}
                  </p>
                )}

                {(task.tags?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(task.tags || []).map((tag) => (
                      <TagBadge key={tag.id} tag={tag} />
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {task.due_date && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px]",
                        isOverdue ? "text-red-500 font-medium" : "text-muted-foreground"
                      )}
                    >
                      <Clock className="h-3 w-3" />
                      {formatDate(task.due_date)}
                    </span>
                  )}
                  {task.reading_item_id && (
                    <Link
                      href={`/library/${task.reading_item_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                    >
                      <BookOpen className="h-3 w-3" />
                      关联阅读
                    </Link>
                  )}
                  {task.note_id && (
                    <Link
                      href={`/notes/${task.note_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                    >
                      <FileText className="h-3 w-3" />
                      关联笔记
                    </Link>
                  )}
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {onComplete && task.status !== "done" && (
                    <DropdownMenuItem onClick={() => onComplete(task)}>
                      <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                      标记完成
                    </DropdownMenuItem>
                  )}
                  {task.status === "done" && onToggleStatus && (
                    <DropdownMenuItem onClick={() => onToggleStatus(task.id, "todo")}>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      标记未完成
                    </DropdownMenuItem>
                  )}
                  {onTogglePin && (
                    <DropdownMenuItem onClick={() => onTogglePin(task.id, !task.is_pinned)}>
                      <Pin className={cn("h-4 w-4 mr-2", task.is_pinned && "fill-current")} />
                      {task.is_pinned ? "取消置顶" : "置顶"}
                    </DropdownMenuItem>
                  )}
                  {onEdit && (
                    <DropdownMenuItem onClick={() => onEdit(task)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      编辑
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onDelete(task.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        删除
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
