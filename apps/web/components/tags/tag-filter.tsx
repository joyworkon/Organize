"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Tag as TagIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagBadge } from "./tag-badge";
import { cn } from "@/lib/utils";
import { TAGS_EMPTY_MESSAGE, shouldShowTagsEmpty } from "@/lib/tags/all-tags-load";
import type { Tag, TagWithCount } from "@organize/shared";

interface TagFilterProps {
  /** 全部可选标签（带使用计数，按使用频率排序更友好） */
  options: TagWithCount[];
  /** 当前选中的标签 id 列表 */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** 最多显示多少个已选 chip 在外面；超出折叠 */
  maxVisibleSelected?: number;
  /** 供调用方把筛选器塞进自己的工具行（U-layout 第四步起不再单独占一条横带） */
  className?: string;
  /** 标签列表加载失败时的错误文案；有值时不算「还没有标签」 */
  loadError?: string | null;
  /** 加载失败后的重试入口（通常传 useAllTags 的 refresh） */
  onRetry?: () => void;
  /** 标签列表是否在加载中（避免首载期间闪「还没有标签」） */
  loading?: boolean;
}

export function TagFilter({
  options,
  selectedIds,
  onChange,
  maxVisibleSelected = 5,
  className,
  loadError,
  onRetry,
  loading = false,
}: TagFilterProps) {
  const [open, setOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTags = useMemo(
    () => options.filter((o) => selectedSet.has(o.id)),
    [options, selectedSet]
  );
  const visibleSelected = selectedTags.slice(0, maxVisibleSelected);
  const hiddenCount = selectedTags.length - visibleSelected.length;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const hasSelection = selectedIds.length > 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {visibleSelected.map((tag) => (
        <TagBadge key={tag.id} tag={tag} active onRemove={() => toggle(tag.id)} />
      ))}
      {hiddenCount > 0 && (
        <span className="text-xs text-muted-foreground">+{hiddenCount}</span>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="按标签筛选"
            className={cn("gap-1.5", hasSelection ? "border-primary text-primary" : "organize-filter-idle")}
          >
            <TagIcon className="h-3.5 w-3.5" />
            标签{hasSelection ? ` · ${selectedIds.length}` : ""}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-2 p-2">
          {loadError && (
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs text-destructive" role="alert">
                {loadError}
              </span>
              {onRetry && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={onRetry}
                >
                  重试
                </Button>
              )}
            </div>
          )}
          {options.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {options.map((tag) => (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  active={selectedSet.has(tag.id)}
                  onClick={() => toggle(tag.id)}
                />
              ))}
            </div>
          ) : shouldShowTagsEmpty(options, loadError ?? null, loading) ? (
            <p className="text-center text-xs text-muted-foreground py-3">{TAGS_EMPTY_MESSAGE}</p>
          ) : loadError ? null : (
            <p className="text-center text-xs text-muted-foreground py-3">加载中…</p>
          )}
          {hasSelection && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => onChange([])}
            >
              清除标签筛选（{selectedIds.length}）
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
