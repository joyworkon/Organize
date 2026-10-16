"use client";

// 资料库「全部」视图（阶段 C）：统一游标列表（/api/library/items），
// 主列表只放阅读物（文章 / 导入文件），速记单独收在顶部「最近速记」条里——
// 速记是想法碎片不是读物，混排会把待读文章淹没；搜索时才把两者合在一起找。
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
import Link from "next/link";
import { BookOpen, ChevronRight, Feather, Loader2 } from "@/components/icons";

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
  /** 首屏（非追加）加载失败：显示错误 + 重试，而不是空库 */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recentMemos, setRecentMemos] = useState<LibraryItem[]>([]);
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
        const q = search.trim();
        const params = new URLSearchParams({ view: q ? "all" : "reading", limit: String(PAGE_SIZE) });
        if (q) params.set("q", q);
        if (selectedTagNamesKey) params.set("tags", selectedTagNamesKey.split("\n").join(","));
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/library/items?${params}`, { cache: "no-store" });
        if (myReqId !== reqIdRef.current) return;
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          if (myReqId !== reqIdRef.current) return;
          const message = data?.error || "资料库加载失败";
          if (append) toast({ title: message, variant: "destructive" });
          else setLoadError(message);
          return;
        }
        const data = (await res.json()) as { items: LibraryItem[]; nextCursor: string | null };
        // await json 期间参数可能已变化：再次复检请求版本，旧结果不得覆盖
        if (myReqId !== reqIdRef.current) return;
        if (!append) setLoadError(null);
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
      } catch {
        if (myReqId === reqIdRef.current) {
          if (append) toast({ title: "资料库加载失败", description: "网络异常，请稍后重试", variant: "destructive" });
          else setLoadError("网络异常，资料库加载失败");
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
    // 参数一变立即作废在途请求（防抖等待期间旧请求也不能再写入）
    reqIdRef.current += 1;
    const timer = setTimeout(() => fetchPage(null, false), 300);
    return () => clearTimeout(timer);
  }, [fetchPage, refreshTick]);

  // 最近速记（不受搜索/标签影响；搜索时主列表已包含速记，条带隐藏）
  useEffect(() => {
    let active = true;
    void fetch(`/api/library/items?${new URLSearchParams({ view: "memo", limit: "3" })}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: LibraryItem[] } | null) => {
        if (active && data?.items) setRecentMemos(data.items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [refreshTick]);

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

      {!hasFilter && recentMemos.length > 0 && (
        <section aria-label="最近速记" className="border-b pb-4">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Feather className="h-3.5 w-3.5" />最近速记</span>
            <Link href="/library?view=memos" className="inline-flex items-center hover:text-foreground">
              全部速记<ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <ul className="divide-y">
            {recentMemos.map((memo) => (
              <li key={memo.id} className="truncate py-1.5 text-sm">{memo.excerpt}</li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <div className="divide-y" aria-busy="true" aria-label="资料库加载中">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-[96px] animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          icon={BookOpen}
          title="资料库加载失败"
          description={loadError}
          action={<Button variant="outline" onClick={() => void fetchPage(null, false)}>重试</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={hasFilter ? "没有找到匹配的内容" : "还没有待读的文章"}
          description={hasFilter ? "试试调整搜索或标签筛选" : "在上方输入框粘贴链接，或拖入文件"}
        />
      ) : (
        <div className="divide-y">
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
