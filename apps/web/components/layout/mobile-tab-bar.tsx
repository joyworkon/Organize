"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Inbox, Library, FileText, Puzzle, ListChecks, Lightbulb } from "lucide-react";

const tabs = [
  { href: "/inbox", label: "收集", icon: Inbox },
  { href: "/library", label: "阅读", icon: Library },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/tasks", label: "待办", icon: ListChecks },
  { href: "/lessons", label: "经验", icon: Lightbulb },
  { href: "/plugins", label: "插件", icon: Puzzle },
];

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-safe left-0 right-0 z-50 border-t bg-background/95 backdrop-blur md:hidden pb-safe">
      <div className="flex items-center justify-between h-14 px-1">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-md transition-all duration-200 min-w-0 flex-1",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className={cn("h-[18px] w-[18px]", isActive && "scale-110")} />
              <span className="text-[9px] font-medium truncate">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
