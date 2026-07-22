"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ReadingCard } from "@/components/reading/reading-card";
import { VirtualList } from "@/components/ui/virtual-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { TagFilter } from "@/components/tags/tag-filter";
import { TagSelector } from "@/components/tags/tag-selector";
import { useAllTags } from "@/components/tags/use-tags";
import { cn } from "@/lib/utils";
import type { ReadingItem, ReadingStatus, Tag } from "@organize/shared";
import {
  BookOpen,
  Clock,
  CheckCircle2,
  BarChart3,
  Search,
  ArrowUpDown,
  CheckSquare,
  X,
  Trash2,
} from "lucide-react";
import Link from "next/link";

type FilterStatus = "all" | ReadingStatus;
type SortField = "created_at" | "updated_at" | "title";
type SortOrder = "asc" | "desc";

const filterTabs: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
  { value: "reading", label: "在读" },
  { value: "read", label: "已读" },
];

const sortFields: SortField[] = ["created_at", "updated_at", "title"];
const sortFieldLabel: Record<SortField, string> = {
  created_at: "创建时间",
  updated_at: "更新时间",
  title: "标题",
};

const PAGE_SIZE = 30;

export default function LibraryPage() {
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // 统计：全量计数（不受当前筛选影响）
  const [stats, setStats] = useState({ total: 0, unread: 0, reading: 0, read: 0 });

  // 批量选择
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const supabase = createClient();
  const { tags: allTags, refresh: refreshTags } = useAllTags();

  // 用 ref 跟踪当前已加载数量，避免它进入 fetchItems 依赖导致频繁重建
  const itemsLenRef = useRef(0);
  itemsLenRef.current = items.length;

  // 用 ref 跟踪最新请求序号，丢弃过期响应（避免竞态：旧请求覆盖新结果）
  const reqIdRef = useRef(0);

  // ---------- 拉取主列表 ----------
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

      // 标签筛选：先从 item_tags 拿到候选 id 集合（多个标签按 OR）
      let scopedIds: string[] | null = null;
      if (selectedTagIds.length > 0) {
        const { data: tagRows } = await supabase
          .from("item_tags")
          .select("item_id")
          .in("tag_id", selectedTagIds);
        if (!tagRows || tagRows.length === 0) {
          if (reqIdRef.current !== myReqId) return; // 已被新请求取代
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
      // 全文搜索：同时匹配标题、摘要、正文
      const q = search.trim();
      if (q) {
        // 转义用户输入里的特殊字符，避免破坏 or 语法
        const safeQ = q.replace(/[,()\\]/g, " ");
        query = query.or(
          `title.ilike.%${safeQ}%,excerpt.ilike.%${safeQ}%,content.ilike.%${safeQ}%`
        );
      }
      if (scopedIds) query = query.in("id", scopedIds);

      // 置顶项永远在前，再按用户选择的字段排序
      query = query
        .order("is_pinned", { ascending: false })
        .order(sortBy, { ascending: sortOrder === "asc" });

      const offset = append ? itemsLenRef.current : 0;
      query = query.range(offset, offset + PAGE_SIZE - 1);

      const { data, count, error } = await query;
      // 丢弃过期响应（切换搜索词/筛选时旧请求后返回）
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
    [supabase, filter, search, sortBy, sortOrder, selectedTagIds]
  );

  // 拉取统计（不受筛选条件影响）
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

  // 筛选条件变化重新加载（带防抖）
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchItems(false);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search, sortBy, sortOrder, selectedTagIds]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const loadMore = () => fetchItems(true);

  // ---------- 单条操作 ----------
  const updateStatus = async (id: string, status: ReadingStatus) => {
    const { error } = await supabase
      .from("reading_items")
      .update({ reading_status: status })
      .eq("id", id);
    if (!error) {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, reading_status: status } : it))
      );
      fetchStats();
    }
  };

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from("reading_items").delete().eq("id", id);
    if (!error) {
      setItems((prev) => prev.filter((it) => it.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fetchStats();
    }
  };

  // ---------- 置顶 ----------
  const togglePin = async (id: string, pinned: boolean) => {
    // 乐观更新
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, is_pinned: pinned } : it))
    );
    const { error } = await supabase
      .from("reading_items")
      .update({ is_pinned: pinned })
      .eq("id", id);
    if (error) {
      // 回滚
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, is_pinned: !pinned } : it))
      );
    }
  };

  // ---------- AI 标签应用后刷新本地 ----------
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

  // ---------- 批量选择 ----------
  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      items.forEach((i) => next.add(i.id));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  // ---------- 批量操作 ----------
  const batchUpdateStatus = async (status: ReadingStatus) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const res = await fetch("/api/reading-items/batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "status", reading_status: status }),
    });
    if (res.ok) {
      setItems((prev) =>
        prev.map((it) => (selectedIds.has(it.id) ? { ...it, reading_status: status } : it))
      );
      clearSelection();
      fetchStats();
    }
  };

  const batchDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`确定删除选中的 ${ids.length} 条？此操作不可撤销。`)) return;
    const res = await fetch("/api/reading-items/batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action: "delete" }),
    });
    if (res.ok) {
      setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
      clearSelection();
      fetchStats();
    }
  };

  const batchAddTag = async (tag: Pick<Tag, "id" | "name">) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    let tagId = tag.id;
    // TagSelector 创建的临时标签以 new: 开头，需先入库
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
                // 判重：已存在该标签就不重复加
                tags:
                  it.tags?.some((t) => t.id === tagId)
                    ? it.tags
                    : [...(it.tags || []), { id: tagId!, name: tag.name } as Tag],
              }
            : it
        )
      );
      clearSelection();
      refreshTags();
    }
  };

  const selectedCount = selectedIds.size;
  const selectionModeActive = selectionMode || selectedCount > 0;
  const allVisibleSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">阅读库</h1>
          <p className="text-muted-foreground mt-1">管理你保存的所有文章和链接</p>
        </div>
      </div>

      {/* 统计面板 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <BarChart3 className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
          <p className="text-xl font-bold">{stats.total}</p>
          <p className="text-xs text-muted-foreground">总计</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <Clock className="h-4 w-4 mx-auto mb-1 text-gray-500" />
          <p className="text-xl font-bold">{stats.unread}</p>
          <p className="text-xs text-muted-foreground">未读</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <BookOpen className="h-4 w-4 mx-auto mb-1 text-blue-500" />
          <p className="text-xl font-bold">{stats.reading}</p>
          <p className="text-xs text-muted-foreground">在读</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold">{stats.read}</p>
          <p className="text-xs text-muted-foreground">已读</p>
        </div>
      </div>

      {/* 工具条：搜索 + 排序 + 批量 */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索标题..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              const idx = sortFields.indexOf(sortBy);
              setSortBy(sortFields[(idx + 1) % sortFields.length]);
            }}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortFieldLabel[sortBy]}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
          >
            {sortOrder === "desc" ? "降序" : "升序"}
          </Button>
          <Button
            variant={selectionMode ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setSelectionMode(!selectionMode);
              if (selectionMode) setSelectedIds(new Set());
            }}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            批量
          </Button>
        </div>
      </div>

      {/* 标签筛选 */}
      {allTags.length > 0 && (
        <TagFilter
          options={allTags}
          selectedIds={selectedTagIds}
          onChange={setSelectedTagIds}
        />
      )}

      {/* 状态筛选 tab */}
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
          </button>
        ))}
      </div>

      {/* 批量操作浮动条 */}
      {selectionModeActive && (
        <div className="sticky top-0 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b flex flex-wrap items-center gap-2">
          <Checkbox checked={allVisibleSelected} onCheckedChange={(c) => (c ? selectAllVisible() : clearSelection())} />
          <span className="text-sm font-medium">已选 {selectedCount} 项</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => batchUpdateStatus("read")}>
            标为已读
          </Button>
          <Button size="sm" variant="outline" onClick={() => batchUpdateStatus("unread")}>
            标为未读
          </Button>
          <TagSelector
            selected={[]}
            options={allTags}
            onChange={(next) => {
              const last = next[next.length - 1];
              if (last) batchAddTag(last);
            }}
            triggerLabel="打标签"
          />
          <Button size="sm" variant="destructive" className="gap-1.5" onClick={batchDelete}>
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>{search || selectedTagIds.length ? "没有找到匹配的内容" : "暂无内容"}</p>
          <Link href="/inbox" className="text-primary underline text-sm mt-2 inline-block">
            去收集箱添加链接
          </Link>
        </div>
      ) : items.length > 50 ? (
        <VirtualList
          items={items}
          itemHeight={140}
          overscan={5}
          className="overflow-y-auto h-[calc(100vh-420px)]"
          renderItem={(item) => (
            <Link href={`/library/${item.id}`} className="block px-1 py-1">
              <ReadingCard
                item={item}
                onStatusChange={updateStatus}
                onDelete={deleteItem}
                selected={selectedIds.has(item.id)}
                onSelectChange={selectionModeActive ? toggleSelect : undefined}
                selectionMode={selectionMode}
                onTogglePin={togglePin}
                onTagsApplied={handleTagsApplied}
              />
            </Link>
          )}
        />
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <Link key={item.id} href={`/library/${item.id}`}>
              <ReadingCard
                item={item}
                onStatusChange={updateStatus}
                onDelete={deleteItem}
                selected={selectedIds.has(item.id)}
                onSelectChange={selectionModeActive ? toggleSelect : undefined}
                selectionMode={selectionMode}
                onTogglePin={togglePin}
              />
            </Link>
          ))}
        </div>
      )}

      {/* 加载更多 */}
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
