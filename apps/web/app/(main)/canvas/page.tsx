"use client";

/**
 * 构思画布列表（docs/idea-canvas-plan.md §1）：新建 / 重命名 / 复制 / 软删除，
 * 按最近修改排序；空态直接给「新建构思画布」+ 双击输入的一句提示。
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Plus, Trash2 } from "@/components/icons";
import { CANVAS_SCHEMA_VERSION, type CanvasDoc } from "@/lib/canvas/model";
import {
  createCanvas,
  deleteCanvas,
  duplicateCanvas,
  getCanvas,
  listCanvases,
  patchCanvas,
  type CanvasListItem,
} from "@/lib/canvas/repository";
import { Button } from "@/components/ui/button";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { toast } from "@/hooks/use-toast";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CanvasListPage() {
  const router = useRouter();
  const [items, setItems] = useState<CanvasListItem[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await listCanvases();
    setItems(list ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const content: CanvasDoc = { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] };
      const res = await createCanvas({ id: crypto.randomUUID(), title: "", content });
      if (res.ok) {
        router.push(`/canvas/${res.row.id}`);
      } else {
        toast({ title: "新建失败，请重试", variant: "destructive" });
      }
    } finally {
      setCreating(false);
    }
  }, [creating, router]);

  const rename = useCallback(
    async (item: CanvasListItem) => {
      const name = (await showPrompt({ title: "重命名画布", defaultValue: item.title || "未命名画布" }))?.trim();
      if (name === undefined) return;
      const row = await getCanvas(item.id);
      if (!row.ok) return;
      const res = await patchCanvas(item.id, { title: name, expectedRevision: row.row.revision });
      if (res.ok) void refresh();
      else toast({ title: "重命名失败", variant: "destructive" });
    },
    [refresh],
  );

  const duplicate = useCallback(
    async (item: CanvasListItem) => {
      setBusyId(item.id);
      try {
        const row = await getCanvas(item.id);
        if (!row.ok) return;
        const res = await duplicateCanvas(row.row, crypto.randomUUID());
        if (res.ok) void refresh();
        else toast({ title: "复制失败", variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (item: CanvasListItem) => {
      setBusyId(item.id);
      try {
        const res = await deleteCanvas(item.id);
        if (res.ok) {
          toast({ title: "已移入垃圾箱" });
          void refresh();
        } else {
          toast({ title: "删除失败", variant: "destructive" });
        }
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">构思画布</h1>
        <Button onClick={() => void create()} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          新建构思画布
        </Button>
      </div>

      {items === null ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : items.length === 0 ? (
        <div className="canvas-list-empty">
          <p className="text-lg font-medium">还没有画布</p>
          <p className="text-sm text-muted-foreground">
            把想法写下来，让版式自己长出来：双击画布空白处即可开始输入。
          </p>
          <Button onClick={() => void create()} disabled={creating}>
            <Plus className="h-4 w-4" /> 新建构思画布
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="canvas-list-card">
              <button
                type="button"
                className="canvas-list-open"
                onClick={() => router.push(`/canvas/${item.id}`)}
                title="打开画布"
              >
                <span className="truncate text-sm font-medium">{item.title || "未命名画布"}</span>
                <span className="text-xs text-muted-foreground">{timeLabel(item.updated_at)}</span>
              </button>
              <div className="canvas-list-actions">
                <button
                  type="button"
                  className="canvas-list-action"
                  title="重命名"
                  aria-label={`重命名 ${item.title || "未命名画布"}`}
                  onClick={() => void rename(item)}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="canvas-list-action"
                  title="创建副本"
                  aria-label={`创建副本 ${item.title || "未命名画布"}`}
                  disabled={busyId === item.id}
                  onClick={() => void duplicate(item)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="canvas-list-action is-danger"
                  title="移入垃圾箱"
                  aria-label={`删除 ${item.title || "未命名画布"}`}
                  disabled={busyId === item.id}
                  onClick={() => void remove(item)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
