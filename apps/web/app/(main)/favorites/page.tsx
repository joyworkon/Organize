"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PageHeader } from "@/components/layout/page-header";
import { Star, BookOpen, FileText, ListChecks, LayoutList, Loader2, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/ui/empty-state";
import type { Favorite, FavoriteTargetType, ReadingItem, Note, Task } from "@organize/shared";
import { TASK_STATUS_CONFIG } from "@organize/shared";

type TabFilter = "all" | "reading" | "note" | "task";

interface FavoriteWithItem extends Favorite {
  item?: ReadingItem | Note | Task;
}

export default function FavoritesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteWithItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");

  const fetchFavorites = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: favs } = await supabase
        .from("favorites")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      const favList: FavoriteWithItem[] = (favs || []).map((f: any) => ({ ...f }));

      const readingIds = favList.filter(f => f.target_type === "reading").map(f => f.target_id);
      const noteIds = favList.filter(f => f.target_type === "note").map(f => f.target_id);
      const taskIds = favList.filter(f => f.target_type === "task").map(f => f.target_id);

      const [readingsRes, notesRes, tasksRes] = await Promise.all([
        readingIds.length > 0
          ? supabase.from("reading_items").select("id, title, url, site_name").in("id", readingIds)
          : Promise.resolve({ data: [] }),
        noteIds.length > 0
          ? supabase.from("notes").select("id, title").in("id", noteIds)
          : Promise.resolve({ data: [] }),
        taskIds.length > 0
          ? supabase.from("tasks").select("id, title, status").in("id", taskIds)
          : Promise.resolve({ data: [] }),
      ]);

      const readingMap = new Map((readingsRes.data || []).map((r: any) => [r.id, r as ReadingItem]));
      const noteMap = new Map((notesRes.data || []).map((n: any) => [n.id, n as Note]));
      const taskMap = new Map((tasksRes.data || []).map((t: any) => [t.id, t as Task]));

      favList.forEach(fav => {
        if (fav.target_type === "reading") {
          fav.item = readingMap.get(fav.target_id);
        } else if (fav.target_type === "note") {
          fav.item = noteMap.get(fav.target_id);
        } else if (fav.target_type === "task") {
          fav.item = taskMap.get(fav.target_id);
        }
      });

      setFavorites(favList);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const handleUnfavorite = async (e: React.MouseEvent, fav: FavoriteWithItem) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("id", fav.id);
      if (error) throw error;
      toast({ title: "已取消收藏" });
      setFavorites(prev => prev.filter(f => f.id !== fav.id));
    } catch {
      toast({ title: "操作失败", variant: "destructive" });
    }
  };

  const filteredFavorites = activeTab === "all"
    ? favorites
    : favorites.filter(f => f.target_type === activeTab);

  const counts = {
    all: favorites.length,
    reading: favorites.filter(f => f.target_type === "reading").length,
    note: favorites.filter(f => f.target_type === "note").length,
    task: favorites.filter(f => f.target_type === "task").length,
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("zh-CN");
  const getHostname = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };

  const getItemLink = (fav: FavoriteWithItem) => {
    if (fav.target_type === "reading") return `/library/${fav.target_id}`;
    if (fav.target_type === "note") return `/notes/${fav.target_id}`;
    if (fav.target_type === "task") return `/tasks/${fav.target_id}`;
    return "#";
  };

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">首页</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>收藏夹</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        icon={Star}
        title="收藏夹"
        description={`共 ${counts.all} 个收藏`}
      />

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit flex-wrap">
        {([
          { key: "all" as const, label: "全部", icon: LayoutList, count: counts.all },
          { key: "reading" as const, label: "文章", icon: BookOpen, count: counts.reading },
          { key: "note" as const, label: "笔记", icon: FileText, count: counts.note },
          { key: "task" as const, label: "待办", icon: ListChecks, count: counts.task },
        ]).map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5",
              activeTab === key
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className={cn(
              "text-xs px-1.5 py-0.5 rounded-full",
              activeTab === key ? "bg-primary/10 text-primary" : "bg-muted-foreground/10"
            )}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          加载中...
        </div>
      ) : filteredFavorites.length === 0 ? (
        <EmptyState
          icon={Star}
          title="还没有收藏内容"
          description="点击文章、笔记或任务上的星标图标即可收藏"
        />
      ) : (
        <div className="space-y-2">
          {filteredFavorites.map((fav) => {
            const href = getItemLink(fav);
            const isReading = fav.target_type === "reading";
            const isNote = fav.target_type === "note";
            const isTask = fav.target_type === "task";
            const reading = isReading ? fav.item as ReadingItem : null;
            const note = isNote ? fav.item as Note : null;
            const task = isTask ? fav.item as Task : null;

            return (
              <Link key={fav.id} href={href}>
                <div className="hover:bg-accent border rounded-md p-3 mb-2 transition-colors cursor-pointer group flex items-start gap-3">
                  <div className={cn(
                    "h-8 w-8 rounded-md flex items-center justify-center shrink-0 mt-0.5",
                    isReading && "bg-blue-500/10",
                    isNote && "bg-purple-500/10",
                    isTask && "bg-green-500/10"
                  )}>
                    {isReading && <BookOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                    {isNote && <FileText className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
                    {isTask && <ListChecks className="h-4 w-4 text-green-600 dark:text-green-400" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium leading-tight line-clamp-1">
                      {isReading && (reading?.title || reading?.url || "已删除的文章")}
                      {isNote && (note?.title || "无标题笔记")}
                      {isTask && (task?.title || "已删除的任务")}
                      {!fav.item && "内容已删除"}
                    </h3>

                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      {isReading && reading?.url && (
                        <span className="flex items-center gap-1">
                          <Globe className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[10rem]">{getHostname(reading.url)}</span>
                        </span>
                      )}
                      {isTask && task && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px]",
                          TASK_STATUS_CONFIG[task.status].color
                        )}>
                          {TASK_STATUS_CONFIG[task.status].label}
                        </span>
                      )}
                      <span>收藏于 {formatDate(fav.created_at)}</span>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-yellow-500 hover:text-yellow-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => handleUnfavorite(e, fav)}
                    title="取消收藏"
                  >
                    <Star className="h-4 w-4 fill-current" />
                  </Button>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
