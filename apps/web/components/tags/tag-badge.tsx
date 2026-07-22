"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tag } from "@organize/shared";

interface TagBadgeProps {
  tag: Pick<Tag, "id" | "name">;
  /** 点击 chip 本身的回调（用于筛选切换等）；不传则不可点 */
  onClick?: (id: string) => void;
  /** 点击删除图标回调；不传则不显示删除图标 */
  onRemove?: (id: string) => void;
  /** 选中态（筛选场景下高亮） */
  active?: boolean;
  className?: string;
}

export function TagBadge({ tag, onClick, onRemove, active, className }: TagBadgeProps) {
  const interactive = typeof onClick === "function";
  return (
    <span
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onClick!(tag.id) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick!(tag.id);
              }
            }
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-muted text-muted-foreground hover:bg-accent",
        interactive && "cursor-pointer",
        className
      )}
    >
      <span className="max-w-[10rem] truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(tag.id);
          }}
          className="rounded-full hover:bg-foreground/10 p-0.5 -mr-0.5"
          aria-label={`移除标签 ${tag.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
