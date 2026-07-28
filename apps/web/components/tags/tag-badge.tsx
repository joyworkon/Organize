"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tag, TagColor } from "@organize/shared";

const COLOR_STYLES: Record<TagColor, string> = {
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-900/50 dark:text-gray-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",
  cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
  purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/50 dark:text-fuchsia-300",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
};

const SIZE_STYLES = {
  sm: "text-[11px] px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
};

interface TagBadgeProps {
  tag: Pick<Tag, "id" | "name" | "color">;
  onClick?: () => void;
  onRemove?: () => void;
  size?: "sm" | "md";
  active?: boolean;
  className?: string;
}

export function TagBadge({ tag, onClick, onRemove, size = "md", active, className }: TagBadgeProps) {
  const interactive = typeof onClick === "function";
  const colorClass = tag.color && COLOR_STYLES[tag.color as TagColor] 
    ? COLOR_STYLES[tag.color as TagColor] 
    : COLOR_STYLES.blue;

  return (
    <span
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium transition-colors",
        SIZE_STYLES[size],
        active
          ? "border-primary bg-primary text-primary-foreground ring-1 ring-primary"
          : colorClass,
        interactive && "cursor-pointer hover:opacity-80",
        className
      )}
    >
      <span className="max-w-[10rem] truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 w-3 h-3 flex items-center justify-center"
          aria-label={`移除标签 ${tag.name}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

export { COLOR_STYLES };
