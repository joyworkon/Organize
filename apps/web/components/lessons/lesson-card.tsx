"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TagBadge } from "@/components/tags/tag-badge";
import { Trash2, Link as LinkIcon, FileText, ListChecks, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LessonWithTags } from "@organize/shared";
import { LESSON_TYPE_CONFIG } from "@organize/shared";

interface LessonCardProps {
  lesson: LessonWithTags;
  onDelete: (id: string) => void;
}

function nodeText(node: any): string {
  if (!node) return "";
  if (node.text) return node.text;
  if (node.content) return (node.content as any[]).map(nodeText).join("");
  return "";
}

function extractExcerpt(content: Record<string, unknown> | null, maxLength = 150): string {
  if (!content) return "";
  const text = nodeText(content);
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function LessonCard({ lesson, onDelete }: LessonCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const typeCfg = LESSON_TYPE_CONFIG[lesson.lesson_type];
  const excerpt = extractExcerpt(lesson.content);

  return (
    <Link href={`/lessons/${lesson.id}`}>
      <Card
        className="group h-full hover:shadow-md transition-all cursor-pointer hover:border-primary/50"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <CardContent className="p-4 flex flex-col h-full">
          <div className="flex items-start gap-3">
            <div className="text-2xl shrink-0 mt-0.5">{typeCfg.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground">{typeCfg.label}</span>
                  </div>
                  <h3 className="font-medium mt-1 line-clamp-1">
                    {lesson.title || "无标题"}
                  </h3>
                </div>
                <div className={cn("flex items-center gap-0.5 transition-opacity shrink-0", isHovered ? "opacity-100" : "opacity-0")}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:text-destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (confirm("确定删除这条经验吗？")) {
                        onDelete(lesson.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {excerpt && (
                <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{excerpt}</p>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {formatDate(lesson.created_at)}
                </span>

                <div className="flex items-center gap-2">
                  {lesson.task_id && (
                    <span className="inline-flex items-center gap-1" title="关联任务">
                      <ListChecks className="h-3 w-3" />
                    </span>
                  )}
                  {lesson.reading_item_id && (
                    <span className="inline-flex items-center gap-1" title="关联文章">
                      <LinkIcon className="h-3 w-3" />
                    </span>
                  )}
                  {lesson.note_id && (
                    <span className="inline-flex items-center gap-1" title="关联笔记">
                      <FileText className="h-3 w-3" />
                    </span>
                  )}
                </div>

                {lesson.tags && lesson.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {lesson.tags.map((tag) => (
                      <TagBadge key={tag.id} tag={tag} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
