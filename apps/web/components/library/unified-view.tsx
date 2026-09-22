"use client";

// 资料库「全部」视图（阶段 C）：统一游标列表（/api/library/items），
// 页内搜索走服务端 q（防抖重新取第一页），标签筛选走 p_tags（标签名）。
// 连续翻页靠三元组游标保证不重不漏（lib/library/cursor.ts + 089 RPC 同一语义）。
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LibraryCard } from "./library-card";
import { TagFilter } from "@/components/tags/tag-filter";
import { useAllTags } from "@/components/tags/use-tags";
import { toast } from "@/hooks/use-toast";
import type { LibraryItem } from "@organize/shared";
import { BookOpen, Loader2 } from "@/components/icons";

const PAGE_SIZE = 30;

export interface UnifiedViewProps {
  /** 页头 PageSearch 的输入（本视图走服务端 q） */
  search: string;
  /** 统一输入框/物料导入入库后递增，触发刷新 */
  refreshTick: number;
}

export function UnifiedView({ search, refreshTick }: UnifiedViewProps) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // 标签筛选（p_tags 走标签名；TagFilter 以 id 为值，这里只把选中 id 映射回 name）
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const { tags: allTags } = useAllTags();

  const reqIdRef = useRef(0);
  const selectedTagNames = allTags.filter((t) => selectedTagIds.includes(t.id)).map((t) => t.name);
  const selectedTagNamesKey = selectedTagNames.join("\n");

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      const myReqId = ++reqIdRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ view: "all", limit: String(PAGE_SIZE) });
        const q = search.trim();
        if (q) params.set("q", q);
        if (selectedTagNamesKey) params.set("tags", selectedTagNamesKey.split("\n").join(","));
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/library/items?${params}`, { cache: "no-store" });
        if (myReqId !== reqIdRef.current) return;
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          toast({ title: data?.error || "资料库加载失败", variant: "destructive" });
          return;
        }
        const data = (await res.json()) as { items: LibraryItem[]; nextCursor: string | null };
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
      } catch {
        if (myReqId === reqIdRef.current) {
          toast({ title: "资料库加载失败", description: "网络异常，请稍后重试", variant: "destructive" });
        }
      } finally {
        if (myReqId === reqIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [search, selectedTagNamesKey]
  );

  // 搜索防抖后重新取第一页；标签/外部刷新同理
  useEffect(() => {
    const timer = setTimeout(() => fetchPage(null, false), 300);
    return () => clearTimeout(timer);
  }, [fetchPage, refreshTick]);

  const loadMore = () => {
    if (nextCursor) void fetchPage(nextCursor, true);
  };

  const hasFilter = search.trim() !== "" || selectedTagIds.length > 0;

  return (
    <div className="space-y-3">
      {allTags.length > 0 && (
        <div className="flex justify-start">
          <TagFilter options={allTags} selectedIds={selectedTagIds} onChange={setSelectedTagIds} />
        </div>
      )}

      {loading ? (
        <div className="grid gap-2 sm:gap-3" aria-busy="true" aria-label="资料库加载中">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-[96px] animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={hasFilter ? "没有找到匹配的内容" : "资料库还是空的"}
          description={hasFilter ? "试试调整搜索或标签筛选" : "在上方输入框写点什么、粘贴链接，或拖入文件"}
        />
      ) : (
        <div className="grid gap-2 sm:gap-3">
          {items.map((item) => (
            <LibraryCard key={`${item.source_type}:${item.id}`} item={item} />
          ))}
        </div>
      )}

      {nextCursor && !loading && (
        <div className="text-center py-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                加载中...
              </>
            ) : (
              "加载更多"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
