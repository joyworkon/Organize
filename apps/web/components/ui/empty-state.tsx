"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <Icon className="h-12 w-12 text-muted-foreground/50 mb-4" />
      {/* h2：空态占位直接位于页面 h1（PageHeader）之下，避免 h1→h3 跳级（C02） */}
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mt-2">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
