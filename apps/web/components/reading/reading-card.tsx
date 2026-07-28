"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "./status-badge";
import { TagBadge } from "@/components/tags/tag-badge";
import { AutoTagDialog } from "@/components/tags/auto-tag-dialog";
import { ShareDialog } from "@/components/share/share-dialog";
import { ListItemContextMenu } from "@/components/context-menu/context-menu-list";
import { cn } from "@/lib/utils";
import type { ReadingItem, ReadingStatus, Tag } from "@organize/shared";
import { ExternalLink, Trash2, Pin, Globe, Clock } from "lucide-react";
import { estimateReadingTime, formatReadingTime } from "@/lib/reading-time";
import { cycleStatus, getHostname } from "./reading-card-utils";
import type { MouseEvent } from "react";
import { FavoriteButton } from "@/components/favorite-button";

interface ReadingCardProps {
  item: ReadingItem;
  onStatusChange?: (id: string, status: ReadingStatus) => void;
  onDelete?: (id: string) => void;
  selected?: boolean;
  onSelectChange?: (id: string, selected: boolean) => void;
  selectionMode?: boolean;
  onTogglePin?: (id: string, pinned: boolean) => void;
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
  const showCheckbox = Boolean(onSelectChange);
  const tags: Tag[] = item.tags || [];
  const hostname = getHostname(item.url);
  const readingMinutes = item.content ? estimateReadingTime(item.content) : null;

  const stop = (e: MouseEvent) => e.stopPropagation();

  const handleToggleStatus = () => {
    const nextStatus = cycleStatus(item.reading_status);
    onStatusChange?.(item.id, nextStatus);
  };

  const handleDelete = () => {
    onDelete?.(item.id);
  };

  const handleTogglePin = () => {
    onTogglePin?.(item.id, !item.is_pinned);
  };

  return (
    <ListItemContextMenu
      type="reading"
      item={item}
      onDelete={onDelete ? handleDelete : undefined}
      onTogglePin={onTogglePin ? handleTogglePin : undefined}
      onToggleStatus={onStatusChange ? handleToggleStatus : undefined}
    >
    <Card
      className={cn(
        "group transition-colors duration-150 relative overflow-hidden",
        showCheckbox ? "hover:bg-primary/5" : "hover:bg-accent",
        selected && "ring-2 ring-primary",
        item.is_pinned && "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:bg-primary"
      )}
    >
      <CardContent className="p-3 sm:p-4">
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
              <h3 className="font-medium leading-tight line-clamp-2 flex-1 min-w-0">
                {item.title || item.url}
              </h3>
              <div
                className={cn(
                  "flex items-center gap-0.5 shrink-0 transition-opacity",
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
                    onClick={(e) => {
                      stop(e);
                      onTogglePin(item.id, !item.is_pinned);
                    }}
                    className={cn(
                      "h-7 w-7 p-0 rounded inline-flex items-center justify-center hover:bg-accent",
                      item.is_pinned ? "text-primary" : "text-muted-foreground"
                    )}
                    title={item.is_pinned ? "取消置顶" : "置顶"}
                  >
                    <Pin className={cn("h-3.5 w-3.5", item.is_pinned && "fill-primary")} />
                  </button>
                )}
                <FavoriteButton targetType="reading" targetId={item.id} className="h-7 w-7" />
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-7 w-7 p-0 rounded inline-flex items-center justify-center hover:bg-accent"
                  title="打开原文"
                  onClick={stop}
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
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
                    onClick={(e) => {
                      stop(e);
                      onDelete(item.id);
                    }}
                    className="h-7 w-7 p-0 rounded inline-flex items-center justify-center hover:bg-accent"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
            </div>

            {item.excerpt && (
              <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                {item.excerpt}
              </p>
            )}

            <div className="flex items-center gap-2 mt-3 flex-wrap text-xs text-muted-foreground">
              <StatusBadge
                status={item.reading_status}
                onClick={
                  onStatusChange
                    ? () => onStatusChange(item.id, cycleStatus(item.reading_status))
                    : undefined
                }
              />

              {item.reading_progress > 0 && item.reading_status !== "read" && (
                <div className="flex items-center gap-1.5" onClick={stop}>
                  <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${Math.round(item.reading_progress * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px]">
                    {Math.round(item.reading_progress * 100)}%
                  </span>
                </div>
              )}

              {hostname && (
                <span className="flex items-center gap-1 line-clamp-1">
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[6rem]">{hostname}</span>
                </span>
              )}

              {readingMinutes && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span>{formatReadingTime(readingMinutes)}</span>
                </span>
              )}

              {tags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap" onClick={stop}>
                  {tags.slice(0, 3).map((t) => (
                    <TagBadge key={t.id} tag={t} size="sm" />
                  ))}
                  {tags.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>
                  )}
                </div>
              )}

              <span className="shrink-0 ml-auto">
                {new Date(item.created_at).toLocaleDateString("zh-CN")}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
    </ListItemContextMenu>
  );
}
