"use client";

// 资料库「集合」视图（阶段 3）：列表 + 详情双态。
//   列表（无 id）：集合卡片（名称/计数），重命名、删除（只删集合，来源不动）、新建。
//   详情（?collection=<id>）：引用行列表——实时 join 来源标题，软删/不可达来源显示
//   「来源不可用」角标（绝不隐藏行）；移出；搜索；游标分页「加载更多」。
// 深链：/library?view=collections&collection=<id>（旧 view 参数全部不受影响）。
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Loader2, FilePlus, Pencil, Trash2 } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DigestPreviewDialog, type DigestRequest } from "./digest-preview-dialog";
import type { CollectionItemView, CollectionSummary } from "@/lib/collections/types";

export function CollectionsView({
  collectionId,
  onCollectionIdChange,
}: {
  /** 详情态：集合 id（null = 列表态） */
  collectionId: string | null;
  onCollectionIdChange: (id: string | null) => void;
}) {
  if (collectionId) {
    return (
      <CollectionItems
        collectionId={collectionId}
        onBack={() => onCollectionIdChange(null)}
      />
    );
  }
  return <CollectionList onOpen={onCollectionIdChange} />;
}

// ---------------- 列表态 ----------------

function CollectionList({ onOpen }: { onOpen: (id: string) => void }) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<CollectionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/collections", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: data?.error || "集合加载失败", variant: "destructive" });
        return;
      }
      setCollections(data.collections ?? []);
    } catch {
      toast({ title: "集合加载失败：网络异常", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: data?.error || "创建失败", variant: "destructive" });
        return;
      }
      setNewName("");
      void load();
    } finally {
      setCreating(false);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    const res = await fetch(`/api/collections/${renaming.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast({ title: data?.error || "重命名失败", variant: "destructive" });
      return;
    }
    setRenaming(null);
    void load();
  };

  const remove = async (collection: CollectionSummary) => {
    if (!window.confirm(`删除集合「${collection.name}」？来源资料不会被删除。`)) return;
    const res = await fetch(`/api/collections/${collection.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast({ title: data?.error || "删除失败", variant: "destructive" });
      return;
    }
    toast({ title: "集合已删除（来源资料保留）" });
    void load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="新建集合：按主题归拢速记、网页与文件…"
          aria-label="新建集合名"
          maxLength={80}
          className="h-9 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !creating) void create();
          }}
        />
        <Button size="sm" className="h-9" disabled={creating || !newName.trim()} onClick={() => void create()}>
          {creating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FilePlus className="mr-1 h-3.5 w-3.5" />}
          新建集合
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[56px] animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={FilePlus}
          title="还没有集合"
          description="在资料卡片或导入文件的「加入集合」里创建；集合只保存引用，不复制内容"
        />
      ) : (
        <ul className="grid gap-2" aria-label="集合列表">
          {collections.map((c) => (
            <li key={c.id}>
              {renaming?.id === c.id ? (
                <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
                  <Input
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    aria-label="集合新名称"
                    maxLength={80}
                    className="h-8 text-sm"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void rename();
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                  <Button size="sm" className="h-8" onClick={() => void rename()}>保存</Button>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setRenaming(null)}>取消</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                    onClick={() => onOpen(c.id)}
                  >
                    {c.name}
                  </button>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {c.itemCount} 项
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    aria-label={`重命名 ${c.name}`}
                    onClick={() => {
                      setRenaming(c);
                      setRenameValue(c.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    aria-label={`删除集合 ${c.name}`}
                    onClick={() => void remove(c)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- 详情态 ----------------

function CollectionItems({
  collectionId,
  onBack,
}: {
  collectionId: string;
  onBack: () => void;
}) {
  const [items, setItems] = useState<CollectionItemView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [digestRequest, setDigestRequest] = useState<DigestRequest | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const qDebouncedRef = useRef("");
  const [qDebounced, setQDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQDebounced(qDebouncedRef.current = q), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const fetchPage = useCallback(async (cursor: string | null, append: boolean, q: string) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      if (q) params.set("q", q);
      const res = await fetch(`/api/collections/${collectionId}/items?${params}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { items?: CollectionItemView[]; nextCursor?: string | null; error?: string }
        | null;
      if (!res.ok) {
        toast({ title: data?.error || "集合内容加载失败", variant: "destructive" });
        return;
      }
      setItems((prev) => (append ? [...prev, ...(data?.items ?? [])] : data?.items ?? []));
      setNextCursor(data?.nextCursor ?? null);
    } catch {
      toast({ title: "集合内容加载失败：网络异常", variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [collectionId]);

  useEffect(() => {
    setItems([]);
    void fetchPage(null, false, qDebounced);
  }, [fetchPage, qDebounced, collectionId]);

  const removeFrom = async (item: CollectionItemView) => {
    const res = await fetch(
      `/api/collections/${collectionId}/items?itemId=${encodeURIComponent(item.id)}`,
      { method: "DELETE" },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast({ title: data?.error || "移出失败", variant: "destructive" });
      return;
    }
    setItems((prev) => prev.filter((row) => row.id !== item.id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  };

  const sourceHref = (item: CollectionItemView): string | null => {
    if (item.sourceType === "memo") return `/library?view=memos&memo=${item.sourceId}`;
    if (item.sourceType === "reading") return `/library/${item.sourceId}`;
    if (item.readingItemId) return `/library/${item.readingItemId}`;
    return null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8" onClick={onBack}>
          ← 全部集合
        </Button>
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="在集合内搜索…"
          aria-label="集合内搜索"
          className="h-8 max-w-64 text-sm"
        />
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            已选 {selected.size} 项（同类型来源才能合并整理）
          </span>
          <Button
            size="sm"
            className="h-8"
            onClick={() => {
              const chosen = items.filter((item) => selected.has(item.id));
              if (!chosen.length) return;
              const sourceType = chosen[0].sourceType;
              setDigestRequest({
                collectionId,
                sourceType,
                ids: chosen.filter((i) => i.sourceType === sourceType).map((i) => i.sourceId),
              });
            }}
          >
            生成整理稿
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[56px] animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={FilePlus}
          title="集合里还没有内容"
          description="在资料卡片或导入文件上点「加入集合」"
        />
      ) : (
        <ul className="grid gap-2" aria-label="集合内容">
          {items.map((item) => {
            const href = sourceHref(item);
            const label = item.title
              ?? item.excerpt?.slice(0, 60)
              ?? "（来源不可用）";
            return (
              <li
                key={item.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2.5 text-sm",
                  selected.has(item.id) && "border-primary bg-accent",
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-primary"
                  aria-label={`选中 ${item.title ?? item.fileName ?? "来源"}`}
                  checked={selected.has(item.id)}
                  onChange={(event) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(item.id);
                      else next.delete(item.id);
                      return next;
                    });
                  }}
                />
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-xs",
                    item.sourceType === "file"
                      ? "bg-muted text-muted-foreground"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {item.sourceType === "reading" ? "网页"
                    : item.sourceType === "memo" ? "速记"
                    : "文件"}
                </span>
                {item.available && href ? (
                  <a className="min-w-0 flex-1 truncate hover:underline" href={href}>
                    {item.sourceType === "file" ? (item.fileName ?? item.title ?? "文件") : label}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {label}
                  </span>
                )}
                {!item.available && (
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                    来源不可用
                  </span>
                )}
                {item.sourceType === "file" && item.available && (
                  <a
                    className="text-xs text-primary hover:underline"
                    href={`/api/imports/file?id=${encodeURIComponent(item.sourceId)}`}
                  >
                    下载原件
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground hover:text-destructive"
                  aria-label={`移出集合`}
                  onClick={() => void removeFrom(item)}
                >
                  移出
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <DigestPreviewDialog
        request={digestRequest}
        onClose={() => setDigestRequest(null)}
        onCreated={(digestId) => {
          window.open(`/library/${digestId}`, "_blank");
        }}
      />

      {nextCursor && !loading && (
        <div className="py-2 text-center">
          <Button
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => {
              void fetchPage(nextCursor, true, qDebounced);
            }}
          >
            {loadingMore ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
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
