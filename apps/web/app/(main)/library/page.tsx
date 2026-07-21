"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { ReadingCard } from "@/components/reading/reading-card";
import { VirtualList } from "@/components/ui/virtual-list";
import { cn } from "@/lib/utils";
import type { ReadingItem, ReadingStatus } from "@organize/shared";
import { BookOpen, Clock, CheckCircle2, BarChart3 } from "lucide-react";
import Link from "next/link";

type FilterStatus = "all" | ReadingStatus;

const filterTabs: { value: FilterStatus; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
  { value: "reading", label: "在读" },
  { value: "read", label: "已读" },
];

export default function LibraryPage() {
  const [allItems, setAllItems] = useState<ReadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const supabase = createClient();

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data, error } = await supabase
      .from("reading_items")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setAllItems(data as ReadingItem[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // 统计数据
  const stats = useMemo(() => {
    const total = allItems.length;
    const unread = allItems.filter((i) => i.reading_status === "unread").length;
    const reading = allItems.filter((i) => i.reading_status === "reading").length;
    const read = allItems.filter((i) => i.reading_status === "read").length;
    return { total, unread, reading, read };
  }, [allItems]);

  // 筛选后的列表
  const items = useMemo(() => {
    if (filter === "all") return allItems;
    return allItems.filter((i) => i.reading_status === filter);
  }, [allItems, filter]);

  const updateStatus = async (id: string, status: ReadingStatus) => {
    const { error } = await supabase
      .from("reading_items")
      .update({ reading_status: status })
      .eq("id", id);

    if (!error) {
      setAllItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, reading_status: status } : item
        )
      );
    }
  };

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from("reading_items").delete().eq("id", id);

    if (!error) {
      setAllItems((prev) => prev.filter((item) => item.id !== id));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">阅读库</h1>
          <p className="text-muted-foreground mt-1">
            管理你保存的所有文章和链接
          </p>
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

      {/* 状态筛选 */}
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

      {/* 列表 - 数据量大时使用虚拟列表 */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">加载中...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>暂无内容</p>
          <Link href="/inbox" className="text-primary underline text-sm mt-2 inline-block">
            去收集箱添加链接
          </Link>
        </div>
      ) : items.length > 50 ? (
        <VirtualList
          items={items}
          itemHeight={132}
          overscan={5}
          className="overflow-y-auto h-[calc(100vh-320px)]"
          renderItem={(item) => (
            <Link href={`/library/${item.id}`} className="block px-1 py-1.5">
              <ReadingCard
                item={item}
                onStatusChange={updateStatus}
                onDelete={deleteItem}
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
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
