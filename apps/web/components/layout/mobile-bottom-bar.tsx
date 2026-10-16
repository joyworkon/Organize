"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Optional host for real page context tools. The app shell never renders persistent module tabs. */
export function MobileBottomBar({ children, label = "当前页面操作", className }: { children: ReactNode; label?: string; className?: string }) {
  if (!children) return null;
  return <nav className={cn("mobile-context-bar", className)} aria-label={label}>{children}</nav>;
}
