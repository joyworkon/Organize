"use client";

import * as React from "react";
import {
  ExternalLink,
  Link,
  Eye,
  EyeOff,
  Pin,
  Tag,
  Trash2,
  Check,
  CheckCircle2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuIcon,
} from "@/components/ui/context-menu";
import { toast } from "@/hooks/use-toast";
import type { ReadingItem, NoteWithTags, TaskWithTags } from "@organize/shared";

interface ListItemContextMenuProps {
  type: "reading" | "note" | "task";
  item: ReadingItem | NoteWithTags | TaskWithTags;
  onDelete?: () => void;
  onTogglePin?: () => void;
  onToggleStatus?: () => void;
  onAddTag?: () => void;
  children: React.ReactNode;
}

export function ListItemContextMenu({
  type,
  item,
  onDelete,
  onTogglePin,
  onToggleStatus,
  onAddTag,
  children,
}: ListItemContextMenuProps) {
  const isPinned = item.is_pinned ?? false;

  const handleOpenInNewTab = () => {
    if (type === "reading") {
      const url = (item as ReadingItem).url;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } else if (type === "note") {
      window.open(`/notes/${item.id}`, "_blank", "noopener,noreferrer");
    } else if (type === "task") {
      window.open(`/tasks/${item.id}`, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopyLink = async () => {
    let url = "";
    let successMessage = "链接已复制";

    if (type === "reading") {
      url = (item as ReadingItem).url;
    } else if (type === "note") {
      url = `${window.location.origin}/notes/${item.id}`;
      successMessage = "笔记链接已复制";
    } else if (type === "task") {
      url = `${window.location.origin}/tasks/${item.id}`;
      successMessage = "任务链接已复制";
    }

    try {
      await navigator.clipboard.writeText(url);
      toast({ title: successMessage });
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
  };

  const getStatusLabel = () => {
    if (type === "reading") {
      const status = (item as ReadingItem).reading_status;
      return status === "read" ? "标记为未读" : "标记为已读";
    } else if (type === "task") {
      const status = (item as TaskWithTags).status;
      return status === "done" ? "标记为未完成" : "标记完成";
    }
    return "";
  };

  const renderMenuItems = () => {
    if (type === "reading") {
      const readingItem = item as ReadingItem;
      const isRead = readingItem.reading_status === "read";

      return (
        <>
          <ContextMenuItem onSelect={handleOpenInNewTab}>
            <ContextMenuIcon>
              <ExternalLink className="h-4 w-4" />
            </ContextMenuIcon>
            在新标签页打开
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopyLink}>
            <ContextMenuIcon>
              <Link className="h-4 w-4" />
            </ContextMenuIcon>
            复制链接
          </ContextMenuItem>
          <ContextMenuSeparator />
          {onToggleStatus && (
            <ContextMenuItem onSelect={onToggleStatus}>
              <ContextMenuIcon>
                {isRead ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </ContextMenuIcon>
              {getStatusLabel()}
            </ContextMenuItem>
          )}
          {onTogglePin && (
            <ContextMenuItem onSelect={onTogglePin}>
              <ContextMenuIcon>
                <Pin className="h-4 w-4" />
              </ContextMenuIcon>
              {isPinned ? "取消置顶" : "置顶"}
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onSelect={() => {
              onAddTag?.();
              if (!onAddTag) {
                toast({ title: "标签编辑功能开发中" });
              }
            }}
          >
            <ContextMenuIcon>
              <Tag className="h-4 w-4" />
            </ContextMenuIcon>
            编辑标签
          </ContextMenuItem>
          <ContextMenuSeparator />
          {onDelete && (
            <ContextMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive focus:bg-destructive/10">
              <ContextMenuIcon className="text-destructive">
                <Trash2 className="h-4 w-4" />
              </ContextMenuIcon>
              删除
            </ContextMenuItem>
          )}
        </>
      );
    }

    if (type === "note") {
      return (
        <>
          <ContextMenuItem onSelect={handleOpenInNewTab}>
            <ContextMenuIcon>
              <ExternalLink className="h-4 w-4" />
            </ContextMenuIcon>
            在新标签页打开
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopyLink}>
            <ContextMenuIcon>
              <Link className="h-4 w-4" />
            </ContextMenuIcon>
            复制链接
          </ContextMenuItem>
          <ContextMenuSeparator />
          {onTogglePin && (
            <ContextMenuItem onSelect={onTogglePin}>
              <ContextMenuIcon>
                <Pin className="h-4 w-4" />
              </ContextMenuIcon>
              {isPinned ? "取消置顶" : "置顶"}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {onDelete && (
            <ContextMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive focus:bg-destructive/10">
              <ContextMenuIcon className="text-destructive">
                <Trash2 className="h-4 w-4" />
              </ContextMenuIcon>
              删除
            </ContextMenuItem>
          )}
        </>
      );
    }

    if (type === "task") {
      const taskItem = item as TaskWithTags;
      const isDone = taskItem.status === "done";

      return (
        <>
          <ContextMenuItem onSelect={handleOpenInNewTab}>
            <ContextMenuIcon>
              <ExternalLink className="h-4 w-4" />
            </ContextMenuIcon>
            打开详情
          </ContextMenuItem>
          {onToggleStatus && (
            <ContextMenuItem onSelect={onToggleStatus}>
              <ContextMenuIcon>
                {isDone ? <Check className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              </ContextMenuIcon>
              {getStatusLabel()}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {onTogglePin && (
            <ContextMenuItem onSelect={onTogglePin}>
              <ContextMenuIcon>
                <Pin className="h-4 w-4" />
              </ContextMenuIcon>
              {isPinned ? "取消置顶" : "置顶"}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {onDelete && (
            <ContextMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive focus:bg-destructive/10">
              <ContextMenuIcon className="text-destructive">
                <Trash2 className="h-4 w-4" />
              </ContextMenuIcon>
              删除
            </ContextMenuItem>
          )}
        </>
      );
    }

    return null;
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {renderMenuItems()}
      </ContextMenuContent>
    </ContextMenu>
  );
}
