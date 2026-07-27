"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  TASK_STATUS_CONFIG,
  TASK_PRIORITY_CONFIG,
  TASK_CATEGORY_CONFIG,
  type TaskWithTags,
} from "@organize/shared";
import {
  Pin,
  Pencil,
  Trash2,
  Check,
  Clock,
  Link as LinkIcon,
  FileText,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TagBadge } from "@/components/tags/tag-badge";

interface TaskCardProps {
  task: TaskWithTags;
  onEdit: (task: TaskWithTags) => void;
  onDelete: (taskId: string) => void;
  onToggleStatus: (taskId: string, status: "todo" | "in_progress" | "done" | "cancelled") => void;
  onTogglePin: (taskId: string, pinned: boolean) => void;
  onComplete: (task: TaskWithTags) => void;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const formatted = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  if (diffDays < 0) return { text: `${formatted} (已过期)`, overdue: true, soon: false };
  if (diffDays === 0) return { text: "今天到期", overdue: false, soon: true };
  if (diffDays === 1) return { text: "明天到期", overdue: false, soon: true };
  if (diffDays <= 3) return { text: `${formatted} (${diffDays}天后)`, overdue: false, soon: true };
  return { text: formatted, overdue: false, soon: false };
}

function minutesToText(min: number | null | undefined) {
  if (!min) return null;
  if (min < 60) return `${min}分钟`;
  const hours = Math.floor(min / 60);
  const mins = min % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

function nodeText(node: any): string {
  if (!node) return "";
  if (node.text) return node.text;
  if (node.content) return (node.content as any[]).map(nodeText).join("");
  return "";
}

export function TaskCard({
  task,
  onEdit,
  onDelete,
  onToggleStatus,
  onTogglePin,
  onComplete,
}: TaskCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const statusCfg = TASK_STATUS_CONFIG[task.status];
  const priorityCfg = TASK_PRIORITY_CONFIG[task.priority];
  const categoryCfg = TASK_CATEGORY_CONFIG[task.category];

  const dueDate = task.status !== "done" && task.status !== "cancelled" ? formatDate(task.due_date) : null;
  const isDone = task.status === "done";
  const isCancelled = task.status === "cancelled";

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone || isCancelled) {
      onToggleStatus(task.id, "todo");
    } else {
      onComplete(task);
    }
  };

  return (
    <div
      className={cn(
        "group rounded-lg border bg-card p-4 transition-all hover:shadow-sm",
        isDone && "opacity-60",
        isCancelled && "opacity-40",
        task.is_pinned && "border-primary/40 bg-primary/[0.02]"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={handleCheckboxClick}
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            isDone
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/30 hover:border-primary"
          )}
          title={isDone ? "标记为未完成" : "标记为完成"}
        >
          {isDone && <Check className="h-3 w-3" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  className={cn(
                    "font-medium leading-tight",
                    (isDone || isCancelled) && "line-through text-muted-foreground"
                  )}
                >
                  {task.title}
                </h3>
                <span className={cn("inline-flex items-center gap-1 text-xs font-medium", priorityCfg.color)}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", priorityCfg.dot)} />
                  {priorityCfg.label}
                </span>
                {task.is_pinned && (
                  <Pin className="h-3 w-3 text-primary fill-current" />
                )}
              </div>

              {task.description && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{task.description}</p>
              )}
            </div>

            <div className={cn("flex items-center gap-0.5 transition-opacity", isHovered ? "opacity-100" : "opacity-0")}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={task.is_pinned ? "取消置顶" : "置顶"}
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(task.id, !task.is_pinned);
                }}
              >
                <Pin className={cn("h-3.5 w-3.5", task.is_pinned && "text-primary fill-current")} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="编辑"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:text-destructive"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(task.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="secondary" className={cn("text-xs", categoryCfg.bg, categoryCfg.color, "hover:no-underline")}>
              {categoryCfg.label}
            </Badge>

            <Badge variant="outline" className={cn("text-xs", statusCfg.color)}>
              {statusCfg.label}
            </Badge>

            {dueDate && (
              <span className={cn("inline-flex items-center gap-1", dueDate.overdue && "text-red-500 dark:text-red-400 font-medium", dueDate.soon && !dueDate.overdue && "text-orange-500 dark:text-orange-400")}>
                <Calendar className="h-3 w-3" />
                {dueDate.text}
              </span>
            )}

            {(task.estimated_minutes || task.actual_minutes) && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {task.actual_minutes ? (
                  <>{minutesToText(task.actual_minutes)} / {minutesToText(task.estimated_minutes) || "-"}</>
                ) : (
                  <>预估 {minutesToText(task.estimated_minutes)}</>
                )}
              </span>
            )}

            <div className="flex items-center gap-2">
              {task.reading_item_id && (
                <Link href={`/library/${task.reading_item_id}`} onClick={(e) => e.stopPropagation()} title="关联文章">
                  <LinkIcon className="h-3 w-3 hover:text-foreground" />
                </Link>
              )}
              {task.note_id && (
                <Link href={`/notes/${task.note_id}`} onClick={(e) => e.stopPropagation()} title="关联笔记">
                  <FileText className="h-3 w-3 hover:text-foreground" />
                </Link>
              )}
            </div>

            {task.tags && task.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {task.tags.map((tag) => (
                  <TagBadge key={tag.id} tag={tag} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
