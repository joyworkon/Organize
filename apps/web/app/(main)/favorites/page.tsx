"use client";
import { readingSourceLabel } from "@/lib/reading/source";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageSearch } from "@/components/layout/page-search";
import { filterByPageSearch } from "@/lib/search/page-search";
import { Star, BookOpen, FileText, ListChecks, LayoutList, Loader2, Globe } from "@/components/icons";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/ui/empty-state";
import { isOnline } from "@/lib/offline/network";
import type { FavoriteTargetType, ReadingItem, Note, Task } from "@organize/shared";
import { TASK_STATUS_CONFIG } from "@organize/shared";
import { attachFavoriteItems, type FavoriteWithItem } from "./favorites-load";

type TabFilter = "all" | "reading" | "note" | "task";

export default function FavoritesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteWithItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** 收藏查询失败（在线时）：没有已加载的收藏时显示错误 + 重试，而不是「还没有收藏内容」 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 条目查询失败的类型：这些收藏显示「内容加载失败」并提供重试，不当成已删除 */
  const [itemLoadFailedTypes, setItemLoadFailedTypes] = useState<Set<FavoriteTargetType>>(new Set());
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [search, setSearch] = useState("");

  const fetchFavorites = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: favs, error: favsError } = await supabase
        .from("favorites")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (favsError) {
        // 查询失败不得当空列表清掉旧收藏（谎报「从没收藏过」）：保留旧列表并如实提示；
        // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
        setLoadError(favsError.message || "加载收藏夹失败");
        if (isOnline()) {
          toast({ title: "加载收藏夹失败", description: favsError.message, variant: "destructive" });
        }
        return;
      }

      const favList: FavoriteWithItem[] = (favs || []).map((f: any) => ({ ...f }));

      const readingIds = favList.filter(f => f.target_type === "reading").map(f => f.target_id);
      const noteIds = favList.filter(f => f.target_type === "note").map(f => f.target_id);
      const taskIds = favList.filter(f => f.target_type === "task").map(f => f.target_id);

      const [readingsRes, notesRes, tasksRes] = await Promise.all([
        readingIds.length > 0
          ? supabase.from("reading_items").select("id, title, url, tags:tags!item_tags(id, name)").in("id", readingIds)
          : Promise.resolve({ data: [] }),
        noteIds.length > 0
          ? supabase.from("notes").select("id, title, tags:tags!note_tags(id, name)").in("id", noteIds)
          : Promise.resolve({ data: [] }),
        taskIds.length > 0
          ? supabase.from("tasks").select("id, title, status, tags:tags!task_tags(id, name)").in("id", taskIds)
          : Promise.resolve({ data: [] }),
      ]);

      const plan = attachFavoriteItems(favList, {
        reading: readingsRes,
        note: notesRes,
        task: tasksRes,
      });

      setFavorites(plan.favorites);
      setLoadError(null);
      setItemLoadFailedTypes(plan.failedTypes);
      // 某类条目查询失败：不冒充「内容已删除」，内联提示常驻，在线时再弹一次 toast
      if (plan.failedTypes.size > 0 && isOnline()) {
        toast({ title: "部分收藏内容加载失败", variant: "destructive" });
      }
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

  const byTab = activeTab === "all"
    ? favorites
    : favorites.filter(f => f.target_type === activeTab);
  // 页内搜索：收藏项的标题 + 其自身标签（文章额外可搜站点/链接）
  const filteredFavorites = filterByPageSearch(byTab, search, (fav) => {
    const item = fav.item as (ReadingItem & Note & Task) | undefined;
    return {
      title: item?.title ?? null,
      tags: (item as { tags?: Array<{ name?: string | null }> } | undefined)?.tags,
      extra: [(item as ReadingItem | undefined)?.url],
    };
  });

  const counts = {
    all: favorites.length,
    reading: favorites.filter(f => f.target_type === "reading").length,
    note: favorites.filter(f => f.target_type === "note").length,
    task: favorites.filter(f => f.target_type === "task").length,
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("zh-CN");
  const getHostname = (url: string) => {
    try { return readingSourceLabel(url); } catch { return ""; }
  };

  const getItemLink = (fav: FavoriteWithItem) => {
    if (fav.target_type === "reading") return `/library/${fav.target_id}`;
    if (fav.target_type === "note") return `/notes/${fav.target_id}`;
    if (fav.target_type === "task") return `/tasks/${fav.target_id}`;
    return "#";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Star}
        title="收藏夹"
        search={
          <PageSearch
            value={search}
            onChange={setSearch}
            placeholder="搜索收藏（标题 / 标签）"
          />
        }
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

      {/* toast 会消失：部分条目加载失败要有持久的行内提示 + 就地重试（离线失败由顶栏角标表达，不弹 toast） */}
      {itemLoadFailedTypes.size > 0 && (
        <div
          className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2"
          role="alert"
        >
          <p className="text-xs text-destructive">部分收藏内容加载失败</p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void fetchFavorites()}>
            重试
          </Button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          加载中...
        </div>
      ) : loadError && favorites.length === 0 ? (
        <EmptyState
          icon={Star}
          title="收藏夹加载失败"
          description={loadError}
          action={<Button variant="outline" onClick={() => void fetchFavorites()}>重试</Button>}
        />
      ) : filteredFavorites.length === 0 ? (
        <EmptyState
          icon={Star}
          title={search.trim() ? "没有匹配的收藏" : "还没有收藏内容"}
          description={search.trim() ? "换个关键词试试，只搜收藏夹内的标题与标签" : "点击文章、笔记或任务上的星标图标即可收藏"}
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
                <div className="hover:bg-accent border-0 border-b rounded-none px-1 py-3 mb-0 transition-colors cursor-pointer group flex items-start gap-3">
                  <div className={cn(
                    "h-8 w-8 rounded-md flex items-center justify-center shrink-0 mt-0.5",
                    isReading && "bg-muted",
                    isNote && "bg-muted",
                    isTask && "bg-muted"
                  )}>
                    {isReading && <BookOpen className="h-4 w-4 text-muted-foreground" />}
                    {isNote && <FileText className="h-4 w-4 text-muted-foreground" />}
                    {isTask && <ListChecks className="h-4 w-4 text-muted-foreground" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h2 className="font-medium leading-tight line-clamp-1">
                      {/* 缺 item 只显示一段文字：查询失败是「加载失败」，查得到但没有才是「已删除」 */}
                      {!fav.item && (fav.itemLoadFailed ? "内容加载失败" : "内容已删除")}
                      {fav.item && isReading && (reading?.title || reading?.url)}
                      {fav.item && isNote && (note?.title || "无标题笔记")}
                      {fav.item && isTask && task?.title}
                    </h2>

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
                    className="h-8 w-8 text-yellow-500 hover:text-yellow-600 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 transition-opacity shrink-0"
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
