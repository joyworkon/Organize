"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./status-badge";
import { TagBadge } from "@/components/tags/tag-badge";
import { AutoTagDialog } from "@/components/tags/auto-tag-dialog";
import { ShareDialog } from "@/components/share/share-dialog";
import { cn } from "@/lib/utils";
import type { ReadingItem, ReadingStatus, Tag } from "@organize/shared";
import { ExternalLink, Trash2, Pin } from "lucide-react";
import type { MouseEvent } from "react";

interface ReadingCardProps {
  item: ReadingItem;
  onStatusChange?: (id: string, status: ReadingStatus) => void;
  onDelete?: (id: string) => void;
  /** 是否选中（批量模式下） */
  selected?: boolean;
  /** 选中状态变化回调；传入即启用批量模式（显示 checkbox） */
  onSelectChange?: (id: string, selected: boolean) => void;
  /** 是否处于批量选择模式（显式控制 checkbox 常驻显示） */
  selectionMode?: boolean;
  /** 置顶状态切换回调 */
  onTogglePin?: (id: string, pinned: boolean) => void;
  /** AI 自动打标签后回调（父组件刷新标签展示） */
  onTagsApplied?: (id: string, tagNames: string[]) => void;
}

export function ReadingCard({
  item,
  onStatusChange,
  onDelete,
  selected = false,
  onSelectChange,
  selectionMode = false,
  onTogglePin,
  onTagsApplied,
}: ReadingCardProps) {
  const cycleStatus = (current: ReadingStatus): ReadingStatus => {
    const order: ReadingStatus[] = ["unread", "reading", "read"];
    const idx = order.indexOf(current);
    return order[(idx + 1) % order.length];
  };

  const showCheckbox = Boolean(onSelectChange);
  const tags: Tag[] = item.tags || [];

  // 阻止卡片内交互点击冒泡到外层 Link
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <Card
      className={cn(
        "group hover:shadow-md transition-all duration-200",
        selected && "ring-2 ring-primary",
        item.is_pinned && "border-primary/40 bg-primary/5"
      )}
    >
      <CardContent className="p-4">
        <div className="flex gap-3">
          {showCheckbox && (
            <div className="flex items-start pt-1" onClick={stop}>
              <Checkbox
                checked={selected}
                onCheckedChange={(checked) => onSelectChange!(item.id, checked === true)}
                className={cn(!selectionMode && "opacity-0 group-hover:opacity-100")}
              />
            </div>
          )}

          {item.cover_image && (
            <div className="relative w-20 h-20 rounded-md overflow-hidden shrink-0 hidden sm:block">
              <Image
                src={item.cover_image}
                alt=""
                fill
                sizes="80px"
                className="object-cover"
                loading="lazy"
              />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium leading-tight line-clamp-2">
                {item.title || item.url}
              </h3>
              <div
                className={cn(
                  "flex items-center gap-1 shrink-0 transition-opacity",
                  selectionMode
                    ? "opacity-100"
                    : item.is_pinned
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100"
                )}
                onClick={stop}
              >
                {onTogglePin && (
                  <button
                    onClick={() => onTogglePin(item.id, !item.is_pinned)}
                    className={cn(
                      "p-1.5 rounded hover:bg-accent",
                      item.is_pinned ? "text-primary" : "text-muted-foreground"
                    )}
                    title={item.is_pinned ? "取消置顶" : "置顶"}
                  >
                    <Pin className={cn("h-4 w-4", item.is_pinned && "fill-primary")} />
                  </button>
                )}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded hover:bg-accent"
                  title="打开原文"
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
                <AutoTagDialog
                  resourceType="reading_item"
                  resourceId={item.id}
                  triggerSize="icon"
                  onApplied={(names) => onTagsApplied?.(item.id, names)}
                />
                <ShareDialog
                  resourceType="reading_item"
                  resourceId={item.id}
                  triggerSize="icon"
                />
                {onDelete && (
                  <button
                    onClick={() => onDelete(item.id)}
                    className="p-1.5 rounded hover:bg-accent"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
            </div>

            {item.excerpt && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {item.excerpt}
              </p>
            )}

            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <StatusBadge
                status={item.reading_status}
                onClick={
                  onStatusChange
                    ? () => onStatusChange(item.id, cycleStatus(item.reading_status))
                    : undefined
                }
              />

              {item.reading_progress > 0 && item.reading_status !== "read" && (
                <div className="flex items-center gap-1.5">
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${Math.round(item.reading_progress * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(item.reading_progress * 100)}%
                  </span>
                </div>
              )}

              <span className="text-xs text-muted-foreground">
                {new Date(item.created_at).toLocaleDateString("zh-CN")}
              </span>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2" onClick={stop}>
                {tags.slice(0, 4).map((t) => (
                  <TagBadge key={t.id} tag={t} />
                ))}
                {tags.length > 4 && (
                  <span className="text-xs text-muted-foreground self-center">
                    +{tags.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
