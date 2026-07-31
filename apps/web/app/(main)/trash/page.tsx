"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Database as DatabaseIcon,
  FileText,
  Lightbulb,
  ListChecks,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/hooks/use-toast";
import {
  listTrash,
  mutateTrash,
  type TrashItem,
} from "@/lib/trash/client";
import type { TrashResourceType } from "@/lib/trash/contracts";
import { cn } from "@/lib/utils";

type TrashFilter = "all" | TrashResourceType;

const resourceConfig = {
  note: { label: "笔记", icon: FileText },
  reading_item: { label: "文章", icon: BookOpen },
  task: { label: "任务", icon: ListChecks },
  lesson: { label: "经验", icon: Lightbulb },
  database: { label: "数据库", icon: DatabaseIcon },
} satisfies Record<
  TrashResourceType,
  { label: string; icon: typeof FileText }
>;

const filters: { value: TrashFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "note", label: "笔记" },
  { value: "reading_item", label: "文章" },
  { value: "task", label: "任务" },
  { value: "lesson", label: "经验" },
  { value: "database", label: "数据库" },
];

export default function TrashPage() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TrashFilter>("all");
  const [pendingOperation, setPendingOperation] = useState<{
    key: string;
    action: "restore" | "permanent_delete";
  } | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listTrash());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "无法读取垃圾箱"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const visibleItems = useMemo(
    () =>
      filter === "all"
        ? items
        : items.filter((item) => item.resource_type === filter),
    [filter, items]
  );

  const removeLocalItem = (item: TrashItem) => {
    setItems((current) =>
      current.filter(
        (candidate) =>
          candidate.id !== item.id ||
          candidate.resource_type !== item.resource_type
      )
    );
  };

  const restoreItem = async (item: TrashItem) => {
    const key = `${item.resource_type}:${item.id}`;
    setPendingOperation({ key, action: "restore" });
    try {
      await mutateTrash(item.resource_type, [item.id], "restore");
      removeLocalItem(item);
      toast({ title: `已恢复${resourceConfig[item.resource_type].label}` });
    } catch (restoreError) {
      toast({
        title: "恢复失败",
        description:
          restoreError instanceof Error ? restoreError.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPendingOperation(null);
    }
  };

  const permanentlyDeleteItem = async (item: TrashItem) => {
    if (
      !confirm(
        `永久删除「${item.title}」？相关内容将无法恢复。`
      )
    ) {
      return;
    }
    const key = `${item.resource_type}:${item.id}`;
    setPendingOperation({ key, action: "permanent_delete" });
    try {
      await mutateTrash(item.resource_type, [item.id], "permanent_delete");
      removeLocalItem(item);
      toast({ title: "已永久删除" });
    } catch (deleteError) {
      toast({
        title: "永久删除失败",
        description:
          deleteError instanceof Error ? deleteError.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPendingOperation(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">垃圾箱</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            已删除内容会保留在这里，直到你永久删除
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void loadItems()}
          disabled={loading}
          title="刷新"
          aria-label="刷新垃圾箱"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </header>

      <div
        className="flex max-w-full gap-1 overflow-x-auto border-b pb-2"
        role="tablist"
        aria-label="垃圾箱类型"
      >
        {filters.map((option) => (
          <Button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            variant={filter === option.value ? "secondary" : "ghost"}
            size="sm"
            className="shrink-0"
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在读取垃圾箱
        </div>
      ) : error ? (
        <EmptyState
          icon={Trash2}
          title="垃圾箱加载失败"
          description={error}
          action={
            <Button variant="outline" onClick={() => void loadItems()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              重试
            </Button>
          }
        />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title={filter === "all" ? "垃圾箱是空的" : "没有这类已删除内容"}
          description={
            filter === "all"
              ? "从内容列表删除的项目会出现在这里"
              : "切换到其他类型查看"
          }
        />
      ) : (
        <div className="divide-y border-y">
          {visibleItems.map((item) => {
            const config = resourceConfig[item.resource_type];
            const Icon = config.icon;
            const itemKey = `${item.resource_type}:${item.id}`;
            const pending = pendingOperation?.key === itemKey;
            const restoring =
              pending && pendingOperation?.action === "restore";
            const permanentlyDeleting =
              pending && pendingOperation?.action === "permanent_delete";
            return (
              <article
                key={itemKey}
                className="flex min-h-20 items-center gap-3 py-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {config.label}
                    </span>
                    <h2 className="truncate text-sm font-medium" title={item.title}>
                      {item.title}
                    </h2>
                  </div>
                  <time
                    className="mt-1 block text-xs text-muted-foreground"
                    dateTime={item.deleted_at}
                  >
                    删除于 {formatDeletedAt(item.deleted_at)}
                  </time>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void restoreItem(item)}
                    disabled={pendingOperation !== null}
                  >
                    {restoring ? (
                      <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                    ) : (
                      <RotateCcw className="h-4 w-4 sm:mr-2" />
                    )}
                    <span className="hidden sm:inline">恢复</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void permanentlyDeleteItem(item)}
                    disabled={pendingOperation !== null}
                  >
                    {permanentlyDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                    ) : (
                      <Trash2 className="h-4 w-4 sm:mr-2" />
                    )}
                    <span className="hidden sm:inline">永久删除</span>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDeletedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
