"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BatchActionsBarProps {
  selectedCount: number;
  totalCount: number;
  onClear: () => void;
  onSelectAll: () => void;
  actions: React.ReactNode;
  typeLabel: string;
  className?: string;
}

export function BatchActionsBar({
  selectedCount,
  totalCount,
  onClear,
  onSelectAll,
  actions,
  typeLabel,
  className,
}: BatchActionsBarProps) {
  const allSelected = totalCount > 0 && selectedCount === totalCount;

  return (
    <div
      className={cn(
        "sticky top-14 md:top-0 z-30 -mx-4 px-3 sm:px-4 py-2",
        "bg-background/95 backdrop-blur border-b",
        "flex flex-wrap items-center gap-1 sm:gap-2",
        "animate-in slide-in-from-top-2 fade-in duration-200",
        className
      )}
    >
      <Checkbox
        checked={allSelected}
        onCheckedChange={(checked) => {
          if (checked) {
            onSelectAll();
          } else {
            onClear();
          }
        }}
      />
      <span className="text-xs sm:text-sm font-medium truncate">
        已选 {selectedCount}/{totalCount} <span className="hidden sm:inline">{typeLabel}</span>
      </span>
      <div className="flex-1 min-w-[50px]" />
      {actions}
      <Button size="sm" variant="ghost" onClick={onClear} title="取消" className="h-8 w-8 p-0">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
