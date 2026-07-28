"use client";

import { useMemo, useState } from "react";
import { Filter, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagBadge } from "./tag-badge";
import { cn } from "@/lib/utils";
import type { Tag, TagWithCount } from "@organize/shared";

interface TagFilterProps {
  /** 全部可选标签（带使用计数，按使用频率排序更友好） */
  options: TagWithCount[];
  /** 当前选中的标签 id 列表 */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** 最多显示多少个已选 chip 在外面；超出折叠 */
  maxVisibleSelected?: number;
}

export function TagFilter({
  options,
  selectedIds,
  onChange,
  maxVisibleSelected = 5,
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

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleSelected.length > 0 ? (
        visibleSelected.map((tag) => (
          <TagBadge key={tag.id} tag={tag} active onRemove={() => toggle(tag.id)} />
        ))
      ) : (
        <span className="text-xs text-muted-foreground">全部标签</span>
      )}
      {hiddenCount > 0 && (
        <span className="text-xs text-muted-foreground">+{hiddenCount}</span>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent",
              selectedIds.length > 0 && "border-primary text-primary"
            )}
          >
            <Filter className="h-3 w-3" />
            筛选
            <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          {options.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-3">还没有标签</p>
          ) : (
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
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
