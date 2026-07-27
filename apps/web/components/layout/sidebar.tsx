"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Home,
  Inbox,
  Library,
  FileText,
  Puzzle,
  Tag as TagIcon,
  BarChart3,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ListChecks,
  Lightbulb,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";

const navItems = [
  { href: "/", label: "今日", icon: Home },
  { href: "/inbox", label: "收集箱", icon: Inbox },
  { href: "/library", label: "阅读库", icon: Library },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/tasks", label: "待办", icon: ListChecks },
  { href: "/lessons", label: "经验", icon: Lightbulb },
  { href: "/tags", label: "标签", icon: TagIcon },
  { href: "/stats", label: "统计", icon: BarChart3 },
  { href: "/plugins", label: "插件", icon: Puzzle },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const stored = localStorage.getItem("organize-sidebar-collapsed") === "true";
    setCollapsed(stored);
    document.documentElement.dataset.sidebarCollapsed = String(stored);
    return () => {
      delete document.documentElement.dataset.sidebarCollapsed;
    };
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("organize-sidebar-collapsed", String(next));
    document.documentElement.dataset.sidebarCollapsed = String(next);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const NavContent = ({
    compact = false,
    collapsible = false,
  }: {
    compact?: boolean;
    collapsible?: boolean;
  }) => (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-14 items-center border-b",
          compact ? "justify-center gap-0 px-0.5" : "justify-between px-4"
        )}
      >
        <Link
          href="/inbox"
          className={cn("flex items-center font-bold text-lg", compact ? "gap-0" : "gap-2")}
          title={compact ? "Organize" : undefined}
          aria-label={compact ? "Organize 首页" : undefined}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm">
            O
          </span>
          {!compact && "Organize"}
        </Link>
        <div className="flex items-center">
          {!compact && <ThemeToggle />}
          {collapsible && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className={cn(
                "rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                compact ? "p-1.5" : "p-2"
              )}
              title={compact ? "展开侧边栏" : "收起侧边栏"}
              aria-label={compact ? "展开侧边栏" : "收起侧边栏"}
            >
              {compact
                ? <PanelLeftOpen className="h-4 w-4" />
                : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      <nav className={cn("flex-1 space-y-1", compact ? "px-2 py-3" : "p-3")}>
        {navItems.map((item) => {
          const isActive = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              title={compact ? item.label : undefined}
              aria-label={compact ? item.label : undefined}
              className={cn(
                "flex items-center rounded-md py-2 text-sm font-medium transition-colors",
                compact ? "justify-center px-2" : "gap-3 px-3",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!compact && item.label}
            </Link>
          );
        })}
      </nav>

      <div className={cn("border-t", compact ? "p-2" : "p-3")}>
        {compact && (
          <div className="mb-1 flex justify-center">
            <ThemeToggle />
          </div>
        )}
        <Button
          variant="ghost"
          size={compact ? "icon" : "default"}
          className={cn(
            "text-muted-foreground",
            compact ? "w-full justify-center" : "w-full justify-start gap-3"
          )}
          onClick={handleLogout}
          title={compact ? "退出登录" : undefined}
          aria-label={compact ? "退出登录" : undefined}
        >
          <LogOut className="h-4 w-4" />
          {!compact && "退出登录"}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* 桌面端侧边栏 */}
      <aside className="organize-sidebar-desktop hidden transition-[width] duration-200 md:fixed md:inset-y-0 md:flex md:flex-col md:border-r md:bg-card">
        <NavContent compact={collapsed} collapsible />
      </aside>

      {/* 移动端顶栏 */}
      <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center border-b bg-card px-4 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="ml-3 font-bold">Organize</span>
      </header>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-64 bg-card shadow-lg">
            <div className="absolute right-2 top-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <NavContent />
          </div>
        </div>
      )}
    </>
  );
}
