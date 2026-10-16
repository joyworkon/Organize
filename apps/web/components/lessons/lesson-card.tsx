"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, BookOpen, FileText, CheckCircle2, ArrowRight } from "@/components/icons";
import { TagBadge } from "@/components/tags/tag-badge";
import { LESSON_TYPE_CONFIG } from "@organize/shared";
import type { LessonWithTags } from "@organize/shared";

function extractText(content: any): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (content.content) {
    return (content.content as any[])
      .map((node) => {
        if (node.text) return node.text;
        if (node.content) return extractText(node);
        return "";
      })
      .join("");
  }
  return "";
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

interface LessonCardProps {
  lesson: LessonWithTags;
  onDelete?: (id: string) => void;
}

export function LessonCard({ lesson, onDelete }: LessonCardProps) {
  const typeConfig = LESSON_TYPE_CONFIG[lesson.lesson_type];
  const text = extractText(lesson.content);
  const preview = text.slice(0, 120) + (text.length > 120 ? "..." : "");

  return (
    <article className="group col-span-full flex min-h-14 flex-col border-b px-3 py-3 transition-colors duration-100 motion-reduce:duration-0 hover:bg-accent/50">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xl">{typeConfig.icon}</span>
          <div className="min-w-0">
            <h2 className="line-clamp-2 text-base font-semibold leading-tight">
              {lesson.title || "未命名复盘"}
            </h2>
            <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">
              {typeConfig.label} · {formatDate(lesson.created_at)}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="更多操作"
              className="h-11 w-11 shrink-0 p-0 opacity-100 transition-opacity duration-100 motion-reduce:duration-0 focus-visible:opacity-100 md:h-8 md:w-8 md:opacity-0 md:group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {onDelete && (
              <DropdownMenuItem
                onClick={() => onDelete(lesson.id)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="mt-2 flex flex-1 flex-col">
        <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
          {preview || "（无内容）"}
        </p>

        {(lesson.tags?.length || 0) > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {(lesson.tags || []).slice(0, 3).map((tag) => (
              <TagBadge key={tag.id} tag={tag} size="sm" />
            ))}
            {(lesson.tags?.length || 0) > 3 && (
              <span className="text-[10px] text-muted-foreground">+{(lesson.tags?.length || 0) - 3}</span>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          {(lesson.task_id || lesson.reading_item_id || lesson.note_id) && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-wrap">
              {lesson.task_id && <CheckCircle2 className="h-3 w-3 text-green-500" />}
              {lesson.reading_item_id && <BookOpen className="h-3 w-3 text-primary" />}
              {lesson.note_id && <FileText className="h-3 w-3 text-primary" />}
            </div>
          )}
          <Link
            href={`/lessons/${lesson.id}`}
            className="ml-auto inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
          >
            查看 <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </article>
  );
}
