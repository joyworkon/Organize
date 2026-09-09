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
import { useState, type MouseEvent } from "react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Check, Share2, Sparkles } from "lucide-react";
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
  const [mobileDialog, setMobileDialog] = useState<"share" | "tags" | null>(null);
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
                referrerPolicy="no-referrer"
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
                  "hidden md:flex items-center gap-0.5 shrink-0 transition-opacity",
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
                <button
                  type="button"
                  onClick={(e) => {
                    stop(e);
                    window.open(item.url, "_blank", "noopener,noreferrer");
                  }}
                  className="h-7 w-7 p-0 rounded inline-flex items-center justify-center hover:bg-accent"
                  title="打开原文"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <AutoTagDialog
                  resourceType="reading_item"
                  resourceId={item.id}
                  triggerSize="icon"
                  open={mobileDialog === "tags"}
                  onOpenChange={(open) => setMobileDialog(open ? "tags" : null)}
                  onApplied={(names) => onTagsApplied?.(item.id, names)}
                />
                <ShareDialog
                  resourceType="reading_item"
                  resourceId={item.id}
                  triggerSize="icon"
                  open={mobileDialog === "share"}
                  onOpenChange={(open) => setMobileDialog(open ? "share" : null)}
                />
                {onDelete && (
                  <button
                    onClick={(e) => {
                      stop(e);
                      onDelete(item.id);
                    }}
                    className="hidden h-7 w-7 p-0 rounded md:inline-flex items-center justify-center hover:bg-accent"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
              <div className="shrink-0 md:hidden" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" className="grid h-11 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent" aria-label={`文章操作：${item.title || "无标题"}`}><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="mobile-reading-menu w-52" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
                    {onStatusChange && <DropdownMenuItem onSelect={() => onStatusChange(item.id, item.reading_status === "read" ? "unread" : "read")}><Check className="mr-2 h-4 w-4" />{item.reading_status === "read" ? "标为未读" : "标为已读"}</DropdownMenuItem>}
                    {onTogglePin && <DropdownMenuItem onSelect={handleTogglePin}><Pin className="mr-2 h-4 w-4" />{item.is_pinned ? "取消置顶" : "置顶"}</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => setMobileDialog("tags")}><Sparkles className="mr-2 h-4 w-4" />自动打标签</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMobileDialog("share")}><Share2 className="mr-2 h-4 w-4" />分享</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => window.open(item.url, "_blank", "noopener,noreferrer")}><ExternalLink className="mr-2 h-4 w-4" />打开原文</DropdownMenuItem>
                    {onDelete && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={handleDelete} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />移到垃圾箱</DropdownMenuItem></>}
                  </DropdownMenuContent>
                </DropdownMenu>
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
