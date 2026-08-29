"use client";

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { appEvents } from "@/lib/plugin/events";
import { ReadingCard } from "@/components/reading/reading-card";
import { QuickAddBar } from "@/components/reading/quick-add-bar";
import { VirtualList } from "@/components/ui/virtual-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagFilter } from "@/components/tags/tag-filter";
import { TagSelector } from "@/components/tags/tag-selector";
import { useAllTags } from "@/components/tags/use-tags";
import { BatchActionsBar } from "@/components/batch-actions-bar";
import { useSelection } from "@/hooks/use-selection";
import { useHotkey, hasOpenDialog } from "@/lib/hooks/use-hotkey";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ReadingItem, ReadingStatus, Tag } from "@organize/shared";
import {
  BookOpen,
  Clock,
  CheckCircle2,
  Search,
  ListChecks,
  Trash2,
  Pin,
  Sparkles,
  Library,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mutateTrash } from "@/lib/trash/client";

type FilterStatus = "all" | ReadingStatus;
type SmartSortOption = "smart" | "newest" | "oldest" | "reading" | "progress";

const SORT_STORAGE_KEY = "organize:sort-reading";

const sortOptions: { value: SmartSortOption; label: string }[] = [
  { value: "smart", label: "智能推荐" },
  { value: "newest", label: "最新保存" },
  { value: "oldest", label: "最早保存" },
  { value: "reading", label: "阅读中优先" },
  { value: "progress", label: "进度低优先" },
];

const filterTabs: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
  { value: "reading", label: "在读" },
  { value: "read", label: "已读" },
];

const PAGE_SIZE = 30;

function calculateSmartScore(item: ReadingItem, now: number): number {
  let score = 0;
  if (item.is_pinned) score += 1000;
  if (item.reading_status === "reading") score += 50;
  if (item.reading_status === "unread") score += 20;
  const ageMs = now - new Date(item.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 1) score += 30;
  else if (ageDays < 3) score += 15;
  else if (ageDays < 7) score += 5;
  else if (ageDays < 30) score += 1;
  const progress = item.reading_progress || 0;
  if (progress > 0 && progress < 0.3) score += 25;
  else if (progress < 0.8) score += 10;
  if (item.reading_status === "read") score -= 500;
  return score;
}

function sortItems(items: ReadingItem[], sortOption: SmartSortOption): ReadingItem[] {
  const now = Date.now();
  return [...items].sort((a, b) => {
    if (sortOption === "smart") {
      const scoreA = calculateSmartScore(a, now);
      const scoreB = calculateSmartScore(b, now);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortOption === "newest") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortOption === "oldest") {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    if (sortOption === "reading") {
      const statusOrder: Record<ReadingStatus, number> = { reading: 0, unread: 1, read: 2 };
      const orderA = statusOrder[a.reading_status];
      const orderB = statusOrder[b.reading_status];
      if (orderA !== orderB) return orderA - orderB;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortOption === "progress") {
      const statusOrder: Record<ReadingStatus, number> = { unread: 0, reading: 1, read: 2 };
      const orderA = statusOrder[a.reading_status];
      const orderB = statusOrder[b.reading_status];
      if (orderA !== orderB) return orderA - orderB;
      const progressA = a.reading_progress || 0;
      const progressB = b.reading_progress || 0;
      if (progressA !== progressB) return progressA - progressB;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    return 0;
  });
}

export default function LibraryPage() {
  // useSearchParams 需要 Suspense 边界（与 tasks 页同一模式）
  return (
    <Suspense fallback={<div className="grid h-screen place-items-center text-muted-foreground">加载中…</div>}>
      <LibraryPageInner />
    </Suspense>
  );
}

function LibraryPageInner() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [smartSort, setSmartSort] = useState<SmartSortOption>("smart");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);

  // 标签筛选与 ?tags= 双向同步：URL 是入口（侧边栏标签快捷列表带参进入），
  // 手动改筛选 chip 时也回写 URL（router.replace 不产生历史记录），
  // 保证侧边栏高亮与地址栏分享出去的筛选状态始终一致
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlTagIds = searchParams.get("tags");
  useEffect(() => {
    setSelectedTagIds(urlTagIds ? urlTagIds.split(",").filter(Boolean) : []);
  }, [urlTagIds]);

  const changeTagFilter = useCallback(
    (ids: string[]) => {
      setSelectedTagIds(ids);
      const params = new URLSearchParams(searchParams.toString());
      if (ids.length > 0) params.set("tags", ids.join(","));
      else params.delete("tags");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_STORAGE_KEY);
      if (saved && ["smart", "newest", "oldest", "reading", "progress"].includes(saved)) {
        setSmartSort(saved as SmartSortOption);
      }
    } catch {}
  }, []);

  const [stats, setStats] = useState({ total: 0, unread: 0, reading: 0, read: 0 });

  const selection = useSelection<ReadingItem>();
  const { selectedIds, isSelectMode, toggle, selectAll, clear, isSelected } = selection;

  const { tags: allTags, refresh: refreshTags } = useAllTags();

  const itemsLenRef = useRef(0);
  itemsLenRef.current = items.length;

  const reqIdRef = useRef(0);

  const showCheckbox = selectionMode || isSelectMode;

  const fetchItems = useCallback(
    async (append: boolean) => {
      const myReqId = ++reqIdRef.current;
      if (!append) setLoading(true);
      else setLoadingMore(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      let scopedIds: string[] | null = null;
      if (selectedTagIds.length > 0) {
        const { data: tagRows } = await supabase
          .from("item_tags")
          .select("item_id")
          .in("tag_id", selectedTagIds);
        if (!tagRows || tagRows.length === 0) {
          if (reqIdRef.current !== myReqId) return;
          setItems([]);
          setTotal(0);
          setHasMore(false);
          setLoading(false);
          setLoadingMore(false);
          return;
        }
        scopedIds = Array.from(new Set(tagRows.map((r) => r.item_id as string)));
      }

      let query = supabase
        .from("reading_items")
        .select("*, tags:tags!item_tags(*)", { count: "exact" })
        .eq("user_id", user.id);

      if (filter !== "all") query = query.eq("reading_status", filter);
      const q = search.trim();
      if (q) {
        const safeQ = q.replace(/[,()\\]/g, " ");
        query = query.or(
          `title.ilike.%${safeQ}%,excerpt.ilike.%${safeQ}%,content.ilike.%${safeQ}%`
        );
      }
      if (scopedIds) query = query.in("id", scopedIds);

      query = query
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });

      const offset = append ? itemsLenRef.current : 0;
      query = query.range(offset, offset + PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (reqIdRef.current !== myReqId) return;
      if (error) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      const next = (data || []) as unknown as ReadingItem[];
      if (append) {
        setItems((prev) => [...prev, ...next]);
      } else {
        setItems(next);
      }
      setTotal(count ?? 0);
      setHasMore(next.length === PAGE_SIZE);
      setLoading(false);
      setLoadingMore(false);
    },
    [supabase, filter, search, selectedTagIds]
  );

  const fetchStats = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("reading_items")
      .select("reading_status")
      .eq("user_id", user.id);
    const all = data || [];
    setStats({
      total: all.length,
      unread: all.filter((i) => i.reading_status === "unread").length,
      reading: all.filter((i) => i.reading_status === "reading").length,
      read: all.filter((i) => i.reading_status === "read").length,
    });
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchItems(false);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search, selectedTagIds]);

  const sortedItems = useMemo(() => {
    return sortItems(items, smartSort);
  }, [items, smartSort]);

  const handleSortChange = (value: SmartSortOption) => {
    setSmartSort(value);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, value);
    } catch {}
  };

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const loadMore = () => fetchItems(true);

  const exitSelection = useCallback(() => {
    clear();
    setSelectionMode(false);
  }, [clear]);

  // 页面快捷键：/ 聚焦搜索、Esc 退出多选或清空搜索（弹层打开时让位）
  useHotkey([
    {
      key: "/",
      ctrlKey: false,
      metaKey: false,
      handler: () => { if (!hasOpenDialog()) searchInputRef.current?.focus(); },
    },
    {
      key: "escape",
      ctrlKey: false,
      metaKey: false,
      handler: () => {
        if (hasOpenDialog()) return;
        if (showCheckbox) exitSelection();
        else if (search) setSearch("");
      },
    },
  ]);

  const updateStatus = async (id: string, status: ReadingStatus) => {
    const { error } = await supabase
      .from("reading_items")
      .update({ reading_status: status })
      .eq("id", id);
    if (!error) {
      const previous = items.find((it) => it.id === id)?.reading_status;
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, reading_status: status } : it))
      );
      // 事件发射是副作用，放在 setState 更新器外面（项目约定）
      if (previous && previous !== status) {
        appEvents.emit("reading:status-changed", { itemId: id, from: previous, to: status });
      }
      fetchStats();
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm("将这篇文章移入垃圾箱？之后可以恢复。")) return;
    try {
      await mutateTrash("reading_item", [id], "soft_delete");
      setItems((prev) => prev.filter((it) => it.id !== id));
      fetchStats();
      toast({ title: "文章已移入垃圾箱" });
    } catch (error) {
      toast({
        title: "删除失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const togglePin = async (id: string, pinned: boolean) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, is_pinned: pinned } : it))
    );
    const { error } = await supabase
      .from("reading_items")
      .update({ is_pinned: pinned })
      .eq("id", id);
    if (error) {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, is_pinned: !pinned } : it))
      );
    }
  };

  const handleTagsApplied = (id: string, tagNames: string[]) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const existingNames = new Set((it.tags || []).map((t) => t.name));
        const newTags = [
          ...(it.tags || []),
          ...tagNames
            .filter((n) => !existingNames.has(n))
            .map((n) => ({ id: `temp:${n}`, user_id: it.user_id, name: n })),
        ];
        return { ...it, tags: newTags };
      })
    );
    refreshTags();
  };

  const handleToggleSelect = useCallback(
    (id: string, checked: boolean) => {
      if (checked) {
        selection.select(id);
      } else {
        selection.deselect(id);
      }
    },
    [selection]
  );

  const handleCardClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (showCheckbox) {
        e.preventDefault();
        e.stopPropagation();
        toggle(id);
      }
    },
    [showCheckbox, toggle]
  );

  const batchUpdateStatus = async (status: ReadingStatus, label: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const res = await fetch("/api/reading-items/batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "status", reading_status: status }),
    });
    if (res.ok) {
      setItems((prev) =>
        prev.map((it) => (selectedIds.has(it.id) ? { ...it, reading_status: status } : it))
      );
      exitSelection();
      fetchStats();
      toast({ title: `已标记 ${count} 篇为${label}` });
    }
  };

  const batchTogglePin = async (pinned: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const { error } = await supabase
      .from("reading_items")
      .update({ is_pinned: pinned })
      .in("id", ids);
    if (!error) {
      setItems((prev) =>
        prev.map((it) => (selectedIds.has(it.id) ? { ...it, is_pinned: pinned } : it))
      );
      exitSelection();
      toast({ title: `已${pinned ? "置顶" : "取消置顶"} ${count} 篇文章` });
    }
  };

  const batchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`将选中的 ${ids.length} 篇文章移入垃圾箱？`)) return;
    const count = ids.length;
    try {
      await mutateTrash("reading_item", ids, "soft_delete");
      setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
      exitSelection();
      fetchStats();
      toast({ title: `${count} 篇文章已移入垃圾箱` });
    } catch (error) {
      toast({
        title: "批量删除失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const batchAddTag = async (tag: Pick<Tag, "id" | "name">) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    let tagId = tag.id;
    if (tagId?.startsWith("new:")) {
      const createRes = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tag.name }),
      });
      if (!createRes.ok) return;
      const created = await createRes.json();
      tagId = created.id as string;
    }
    if (!tagId) return;

    const count = ids.length;
    const res = await fetch("/api/reading-items/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, tag_id: tagId }),
    });
    if (res.ok) {
      setItems((prev) =>
        prev.map((it) =>
          selectedIds.has(it.id)
            ? {
                ...it,
                tags:
                  it.tags?.some((t) => t.id === tagId)
                    ? it.tags
                    : [...(it.tags || []), { id: tagId!, name: tag.name } as Tag],
              }
            : it
        )
      );
      exitSelection();
      refreshTags();
      toast({ title: `已为 ${count} 篇文章添加标签` });
    }
  };

  const cardProps = (item: ReadingItem) => ({
    item,
    onStatusChange: updateStatus,
    onDelete: deleteItem,
    selected: isSelected(item.id),
    onSelectChange: showCheckbox ? handleToggleSelect : undefined,
    selectionMode: selectionMode || isSelectMode,
    onTogglePin: togglePin,
    onTagsApplied: handleTagsApplied,
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        icon={Library}
        title="稍后读"
        description="保存链接稍后阅读，收集与阅读在同一处完成"
      />

      <QuickAddBar
        onAdded={() => {
          void fetchItems(false);
          void fetchStats();
        }}
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="搜索标题...（按 / 聚焦）"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={smartSort} onValueChange={handleSortChange}>
            <SelectTrigger className="w-auto sm:w-[140px] h-9 gap-1.5 sm:gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <SelectValue className="hidden sm:inline-flex" />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={showCheckbox ? "default" : "ghost"}
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (selectionMode) {
                exitSelection();
              } else {
                setSelectionMode(true);
              }
            }}
          >
            <ListChecks className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">多选</span>
          </Button>
        </div>
      </div>

      {allTags.length > 0 && (
        <TagFilter
          options={allTags}
          selectedIds={selectedTagIds}
          onChange={changeTagFilter}
        />
      )}

      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              filter === tab.value
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            <span className="ml-1.5 text-xs text-muted-foreground">
              {tab.value === "all"
                ? stats.total
                : tab.value === "unread"
                  ? stats.unread
                  : tab.value === "reading"
                    ? stats.reading
                    : stats.read}
            </span>
          </button>
        ))}
      </div>

      {isSelectMode && (
        <BatchActionsBar
          selectedCount={selectedIds.size}
          totalCount={sortedItems.length}
          onClear={exitSelection}
          onSelectAll={() => selectAll(sortedItems.map((i) => i.id))}
          typeLabel="篇文章"
          actions={
            <>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => batchUpdateStatus("read", "已读")} title="标为已读">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">标为已读</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => batchUpdateStatus("unread", "未读")} title="标为未读">
                <Clock className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">标为未读</span>
              </Button>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => batchTogglePin(true)} title="置顶">
                <Pin className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">置顶</span>
              </Button>
              <TagSelector
                selected={[]}
                options={allTags}
                onChange={(next) => {
                  const last = next[next.length - 1];
                  if (last) batchAddTag(last);
                }}
                triggerLabel="标签"
              />
              <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={batchDelete} title="删除">
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">删除</span>
              </Button>
            </>
          }
        />
      )}

      {loading ? (
        <div className="grid gap-2 sm:gap-3" aria-busy="true" aria-label="文章加载中">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-[96px] animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : items.length === 0 ? (
        (() => {
          const hasFilter = search.trim() !== "" || selectedTagIds.length > 0 || filter !== "all";
          return (
            <EmptyState
              icon={BookOpen}
              title={hasFilter ? "没有找到匹配的内容" : "还没有保存的内容"}
              description={hasFilter ? "试试调整筛选条件" : "把链接粘贴到上方输入框，回车即可保存"}
            />
          );
        })()
      ) : sortedItems.length > 50 ? (
        <VirtualList
          items={sortedItems}
          itemHeight={140}
          overscan={5}
          className="overflow-y-auto h-[calc(100vh-420px)]"
          renderItem={(item) => {
            const Wrapper = showCheckbox ? "div" : Link;
            const wrapperProps = showCheckbox
              ? {
                  className: "block px-0.5 py-0.5 sm:px-1 sm:py-1 cursor-pointer",
                  onClick: (e: React.MouseEvent) => handleCardClick(e, item.id),
                }
              : {
                  href: `/library/${item.id}`,
                  className: "block px-0.5 py-0.5 sm:px-1 sm:py-1",
                };
            return (
              <Wrapper key={item.id} {...wrapperProps as any}>
                <ReadingCard {...cardProps(item)} />
              </Wrapper>
            );
          }}
        />
      ) : (
        <div className="grid gap-2 sm:gap-3">
          {sortedItems.map((item) => {
            const Wrapper = showCheckbox ? "div" : Link;
            const wrapperProps = showCheckbox
              ? {
                  className: "cursor-pointer",
                  onClick: (e: React.MouseEvent) => handleCardClick(e, item.id),
                }
              : {
                  href: `/library/${item.id}`,
                };
            return (
              <Wrapper key={item.id} {...wrapperProps as any}>
                <ReadingCard {...cardProps(item)} />
              </Wrapper>
            );
          })}
        </div>
      )}

      {hasMore && !loading && (
        <div className="text-center py-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "加载中..." : `加载更多（已显示 ${items.length} / ${total}）`}
          </Button>
        </div>
      )}
    </div>
  );
}
