"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Pin,
  CheckCircle2,
  MoreHorizontal,
  BookOpen,
  FileText,
  Clock,
  Calendar,
  Trash2,
  Pencil,
  Check,
  CheckSquare,
  GripVertical,
} from "lucide-react";
import { formatDueDate, getDueDateColorClass } from "@/lib/date-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/tags/tag-badge";
import { ListItemContextMenu } from "@/components/context-menu/context-menu-list";
import { FavoriteButton } from "@/components/favorite-button";
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
  selected?: boolean;
  onSelectChange?: (id: string, checked: boolean) => void;
  selectionMode?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, task: TaskWithTags) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>, task: TaskWithTags) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter?: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function TaskCard({
  task,
  onEdit,
  onDelete,
  onToggleStatus,
  onTogglePin,
  onComplete,
  selected = false,
  onSelectChange,
  selectionMode = false,
  draggable = false,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver: onDragOverProp,
  onDragEnd,
  onDrop,
  onDragLeave,
  onDragEnter,
}: TaskCardProps) {
  const router = useRouter();
  const statusConfig = TASK_STATUS_CONFIG[task.status];
  const priorityConfig = TASK_PRIORITY_CONFIG[task.priority];
  const categoryConfig = TASK_CATEGORY_CONFIG[task.category];
  const showCheckbox = Boolean(onSelectChange);

  const checklistCompleted = task.checklists?.filter(c => c.is_completed).length || 0;
  const checklistTotal = task.checklists?.length || 0;

  const isOverdue =
    task.due_date && task.status !== "done" && task.status !== "cancelled" && new Date(task.due_date) < new Date();

  const handleToggleComplete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (task.status === "done") {
      onToggleStatus?.(task.id, "todo");
    } else if (onComplete) {
      onComplete(task);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (showCheckbox) {
      e.preventDefault();
      e.stopPropagation();
      onSelectChange!(task.id, !selected);
      return;
    }
    router.push(`/tasks/${task.id}`);
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDelete = () => {
    onDelete?.(task.id);
  };

  const handleTogglePin = () => {
    onTogglePin?.(task.id, !task.is_pinned);
  };

  const handleToggleStatus = () => {
    if (task.status === "done") {
      onToggleStatus?.(task.id, "todo");
    } else if (onComplete) {
      onComplete(task);
    }
  };

  return (
    <ListItemContextMenu
      type="task"
      item={task}
      onDelete={onDelete ? handleDelete : undefined}
      onTogglePin={onTogglePin ? handleTogglePin : undefined}
      onToggleStatus={(onToggleStatus || onComplete) ? handleToggleStatus : undefined}
    >
    <Card
      onClick={handleCardClick}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, task)}
      onDragOver={onDragOverProp}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop?.(e, task)}
      onDragLeave={onDragLeave}
      onDragEnter={onDragEnter}
      className={cn(
        "group cursor-pointer transition-colors duration-150 border-l-4 relative",
        showCheckbox ? "hover:bg-primary/5" : "hover:bg-accent",
        selected && "ring-2 ring-primary",
        task.is_pinned && "ring-1 ring-primary/20",
        isDragging && "opacity-50",
        isDragOver && "border-t-2 border-t-primary",
        isOverdue && "border-l-red-500",
        !isOverdue && task.status === "done" && "border-l-green-500",
        !isOverdue && task.status !== "done" && task.priority === "high" && "border-l-orange-500",
        !isOverdue && task.status !== "done" && task.priority === "medium" && "border-l-primary",
        !isOverdue && task.status !== "done" && task.priority === "low" && "border-l-muted"
      )}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start gap-3">
          {draggable && (
            <div className="flex items-start pt-1 cursor-grab active:cursor-grabbing">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          {showCheckbox && (
            <div className="flex items-start pt-1" onClick={stop}>
              <Checkbox
                checked={selected}
                onCheckedChange={(checked) => onSelectChange!(task.id, checked === true)}
                className={cn(!selectionMode && "opacity-0 group-hover:opacity-100")}
              />
            </div>
          )}
          {!showCheckbox && (
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
          )}

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

                {checklistTotal > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                    <CheckSquare className="h-3 w-3" />
                    <span>{checklistCompleted}/{checklistTotal}</span>
                  </div>
                )}

                {(task.tags?.length || 0) > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(task.tags || []).map((tag) => (
                      <TagBadge key={tag.id} tag={tag} size="sm" />
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {task.due_date && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs",
                        getDueDateColorClass(task.due_date, task.status)
                      )}
                    >
                      <Calendar className="h-3 w-3" />
                      {formatDueDate(task.due_date)}
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

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <FavoriteButton targetType="task" targetId={task.id} className="h-8 w-8" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={handleButtonClick}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {onComplete && task.status !== "done" && (
                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); e.stopPropagation(); onComplete(task); }}>
                      <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                      标记完成
                    </DropdownMenuItem>
                  )}
                  {task.status === "done" && onToggleStatus && (
                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleStatus(task.id, "todo"); }}>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      标记未完成
                    </DropdownMenuItem>
                  )}
                  {onTogglePin && (
                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin(task.id, !task.is_pinned); }}>
                      <Pin className={cn("h-4 w-4 mr-2", task.is_pinned && "fill-current")} />
                      {task.is_pinned ? "取消置顶" : "置顶"}
                    </DropdownMenuItem>
                  )}
                  {onEdit && (
                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(task); }}>
                      <Pencil className="h-4 w-4 mr-2" />
                      编辑
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(task.id); }}
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
        </div>
      </CardContent>
    </Card>
    </ListItemContextMenu>
  );
}
