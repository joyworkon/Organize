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
  History,
  Star,
  Settings,
} from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { ThemeColorPicker } from "@/components/theme-color-picker";
import { useThemeColor } from "@/hooks/use-theme-color";

const navItems = [
  { href: "/", label: "今日", icon: Home },
  { href: "/inbox", label: "收集箱", icon: Inbox },
  { href: "/library", label: "阅读库", icon: Library },
  { href: "/notes", label: "笔记", icon: FileText },
  { href: "/tasks", label: "待办", icon: ListChecks },
  { href: "/lessons", label: "经验", icon: Lightbulb },
  { href: "/tags", label: "标签", icon: TagIcon },
  { href: "/favorites", label: "收藏夹", icon: Star },
  { href: "/review", label: "回顾", icon: History },
  { href: "/stats", label: "统计", icon: BarChart3 },
  { href: "/plugins", label: "插件", icon: Puzzle },
  { href: "/settings", label: "设置", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  useThemeColor();

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
    onClose,
  }: {
    compact?: boolean;
    collapsible?: boolean;
    onClose?: () => void;
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
          onClick={onClose}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm shrink-0">
            O
          </span>
          {!compact && <span className="truncate">Organize</span>}
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title="关闭菜单"
              aria-label="关闭菜单"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {!compact && !onClose && <ThemeToggle />}
          {collapsible && !onClose && (
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

      <nav className={cn("flex-1 space-y-1 overflow-y-auto", compact ? "px-2 py-3" : "p-3")}>
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
                "flex items-center rounded-md py-2 text-sm font-medium transition-colors min-w-0",
                compact ? "justify-center px-2" : "gap-3 px-3",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!compact && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={cn("border-t", compact ? "p-2" : "p-3")}>
        {compact ? (
          <div className="flex flex-col items-center gap-1">
            <ThemeToggle />
            <ThemeColorPicker compact />
          </div>
        ) : onClose ? (
          <div className="mb-2 space-y-2">
            <div className="flex justify-start">
              <ThemeToggle />
            </div>
            <ThemeColorPicker />
          </div>
        ) : (
          <div className="mb-2">
            <ThemeColorPicker />
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
          <LogOut className="h-4 w-4 shrink-0" />
          {!compact && <span className="truncate">退出登录</span>}
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
      <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center border-b bg-card px-4 md:hidden pt-safe">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <span className="ml-3 font-bold text-lg">Organize</span>
      </header>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/50 animate-in fade-in duration-200"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-card shadow-lg animate-in slide-in-from-left duration-200 flex flex-col">
            <NavContent onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
