"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, BookOpen, FileText, CheckCircle2, ArrowRight } from "lucide-react";
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
    <Card className="group flex flex-col h-full hover:bg-accent transition-colors duration-150">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl shrink-0">{typeConfig.icon}</span>
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight line-clamp-2">
                {lesson.title || "未命名经验"}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {typeConfig.label} · {formatDate(lesson.created_at)}
              </CardDescription>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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
                  <Trash2 className="h-4 w-4 mr-2" />
                  删除
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <p className="text-sm text-muted-foreground line-clamp-3 flex-1">
          {preview || "（无内容）"}
        </p>

        {(lesson.tags?.length || 0) > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {(lesson.tags || []).slice(0, 3).map((tag) => (
              <TagBadge key={tag.id} tag={tag} className="text-[10px] px-1.5 py-0" />
            ))}
            {(lesson.tags?.length || 0) > 3 && (
              <span className="text-[10px] text-muted-foreground">+{(lesson.tags?.length || 0) - 3}</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mt-3 pt-3 border-t">
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
      </CardContent>
    </Card>
  );
}
