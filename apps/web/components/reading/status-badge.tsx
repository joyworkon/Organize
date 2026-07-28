"use client";

import { cn } from "@/lib/utils";
import { READING_STATUS_CONFIG, type ReadingStatus } from "@organize/shared";
import { Clock, BookOpen, CheckCircle2 } from "lucide-react";
import type { MouseEvent } from "react";

interface StatusBadgeProps {
  status: ReadingStatus;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const statusIcons: Record<ReadingStatus, React.ElementType> = {
  unread: Clock,
  reading: BookOpen,
  read: CheckCircle2,
};

export function StatusBadge({ status, onClick, className }: StatusBadgeProps) {
  const Icon = statusIcons[status];
  const config = READING_STATUS_CONFIG[status];

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium transition-all",
        config.color,
        onClick && "cursor-pointer hover:scale-105 active:scale-95",
        className
      )}
      title={onClick ? "点击切换状态" : undefined}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </button>
  );
}
