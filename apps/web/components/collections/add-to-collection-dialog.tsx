"use client";

// 「加入集合」对话框（阶段 3）：选择既有集合或新建；自动主题建议以芯片展示，
// 点击确认才采用——绝不自动写入手动分类。同批导入可整批加入（ids 多值）。
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Check } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { suggestCollections, type CollectionSummary } from "@/lib/collections/types";

export interface AddToCollectionTarget {
  sourceType: "reading" | "memo" | "file";
  ids: string[];
  /** 建议匹配线索：标题（reading/文件名）与标签（memo） */
  hintTitle?: string;
  hintTags?: string[];
}

export function AddToCollectionDialog({
  target,
  onClose,
  onAdded,
}: {
  target: AddToCollectionTarget | null;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newName, setNewName] = useState("");
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/collections", { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          toast({ title: data?.error || "集合加载失败", variant: "destructive" });
          return;
        }
        const list = (data.collections ?? []) as CollectionSummary[];
        setCollections(list);
        setSuggestedIds(suggestCollections(list, { title: target.hintTitle, tags: target.hintTags }));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const suggested = useMemo(
    () => collections.filter((c) => suggestedIds.includes(c.id)),
    [collections, suggestedIds],
  );
  const plain = useMemo(
    () => collections.filter((c) => !suggestedIds.includes(c.id)),
    [collections, suggestedIds],
  );

  if (!target) return null;

  const addTo = async (collectionId: string, collectionName: string) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/collections/${collectionId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: target.sourceType, ids: target.ids }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: data?.error || "加入失败", variant: "destructive" });
        return;
      }
      toast({ title: `已把 ${data.added} 项加入「${collectionName}」` });
      onAdded?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) {
      toast({ title: "集合名不能为空", variant: "destructive" });
      return;
    }
    setSubmitting(true);
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
      await addTo(data.collection.id, data.collection.name);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="加入集合"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border bg-card p-4 shadow-lg">
        <h2 className="text-sm font-semibold">加入集合</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          集合只保存引用，不复制正文或原件{target.ids.length > 1 ? `（本批 ${target.ids.length} 项一起加入）` : ""}
        </p>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto" aria-label="集合列表">
            {suggested.length > 0 && (
              <>
                <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                  可能相关（自动建议，点确认采用）
                </p>
                {suggested.map((c) => (
                  <CollectionRow
                    key={`s-${c.id}`}
                    collection={c}
                    suggested
                    disabled={submitting}
                    onPick={() => void addTo(c.id, c.name)}
                  />
                ))}
              </>
            )}
            {plain.map((c) => (
              <CollectionRow
                key={c.id}
                collection={c}
                disabled={submitting}
                onPick={() => void addTo(c.id, c.name)}
              />
            ))}
            {collections.length === 0 && (
              <p className="px-1 py-3 text-xs text-muted-foreground">
                还没有集合。新建一个，把相关资料归到一起。
              </p>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="新建集合…"
            aria-label="新建集合名"
            maxLength={80}
            className="h-8 text-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !submitting) void createAndAdd();
            }}
          />
          <Button size="sm" className="h-8" disabled={submitting || !newName.trim()} onClick={() => void createAndAdd()}>
            {submitting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
            新建并加入
          </Button>
        </div>

        <div className="mt-2 text-right">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
        </div>
      </div>
    </div>
  );
}

function CollectionRow({
  collection,
  suggested,
  disabled,
  onPick,
}: {
  collection: CollectionSummary;
  suggested?: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60"
      disabled={disabled}
      onClick={onPick}
    >
      {suggested && (
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">建议</span>
      )}
      <span className="min-w-0 flex-1 truncate">{collection.name}</span>
      <span className="text-xs text-muted-foreground">{collection.itemCount} 项</span>
      <Check className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
