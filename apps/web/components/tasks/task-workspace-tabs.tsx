"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, ListChecks, Search, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { key: "tasks", label: "任务", icon: ListChecks },
  { key: "calendar", label: "日历", icon: CalendarDays },
  { key: "countdown", label: "倒数日", icon: Timer },
  { key: "search", label: "搜索", icon: Search },
] as const;

function queryFor(pathname: string, params: URLSearchParams, key: (typeof tabs)[number]["key"]): string {
  const next = new URLSearchParams();
  const scope = params.get("scope");
  const list = params.get("list");
  if ((key === "tasks" || key === "calendar") && scope) {
    next.set("scope", scope);
    if (scope === "list" && list) next.set("list", list);
  }
  if (key === "search" && params.get("q")) next.set("q", params.get("q") || "");
  const value = next.toString();
  return value ? `?${value}` : "";
}

export function taskWorkspaceTabKey(pathname: string): (typeof tabs)[number]["key"] {
  if (pathname === "/tasks/calendar") return "calendar";
  if (pathname === "/tasks/countdown") return "countdown";
  if (pathname === "/tasks/search") return "search";
  return "tasks";
}

export function TaskWorkspaceTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const active = taskWorkspaceTabKey(pathname);
  return (
    <nav
      aria-label="待办工作区"
      role="tablist"
      className="flex shrink-0 gap-1 overflow-x-auto border-b bg-background px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map(({ key, label, icon: Icon }) => {
        const selected = active === key;
        return (
          <Link
            key={key}
            href={`/tasks${key === "tasks" ? "" : `/${key}`}${queryFor(pathname, params, key)}`}
            role="tab"
            aria-selected={selected}
            className={cn(
              "inline-flex min-w-max items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
              selected
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
