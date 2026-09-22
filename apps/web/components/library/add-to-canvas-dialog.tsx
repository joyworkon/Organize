"use client";

/**
 * 资料库「添加到画布」（阶段 E）：选择现有画布（或新建）→ 页面 → 区块，
 * 把资料以引用卡片快照追加到该区块末尾（appendMaterialCardToRegion，
 * 一次 PATCH 事务；冲突 409 如实报错不静默覆盖）。
 * 插入后可在画布中继续编辑快照，原资料不受影响。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LibraryItem } from "@organize/shared";
import {
  createCanvas,
  getCanvas,
  listCanvases,
  patchCanvas,
  type CanvasListItem,
} from "@/lib/canvas/repository";
import { appendMaterialCardToRegion } from "@/lib/canvas/commands";
import { createBoardShape, CANVAS_SCHEMA_VERSION } from "@/lib/canvas/model";
import { excerptSnapshot, sourceRefFromLibraryItem } from "@/lib/library/material-source";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "@/components/icons";
import { toast } from "@/hooks/use-toast";

interface BoardOption {
  id: string;
  name: string;
  regionCount: number;
}

/** 「新建画布」选项的固定 key。 */
const NEW_CANVAS = "__new__";
/** 追加新区块的固定 key。 */
const NEW_REGION = "__new_region__";

export function AddToCanvasDialog({
  item,
  open,
  onOpenChange,
}: {
  item: LibraryItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [canvases, setCanvases] = useState<CanvasListItem[]>([]);
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);
  const [canvasId, setCanvasId] = useState<string>(NEW_CANVAS);
  const [boardId, setBoardId] = useState<string>("");
  const [regionId, setRegionId] = useState<string>(NEW_REGION);
  const [loading, setLoading] = useState(false);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 打开时拉画布列表
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const list = await listCanvases();
      if (cancelled) return;
      setCanvases(list ?? []);
      setCanvasId(NEW_CANVAS);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 选中现有画布 → 拉页面（区块数）
  useEffect(() => {
    if (!open || canvasId === NEW_CANVAS) {
      setBoards([]);
      setBoardId("");
      return;
    }
    let cancelled = false;
    void (async () => {
      setBoardsLoading(true);
      const res = await getCanvas(canvasId);
      if (cancelled) return;
      if (res.ok) {
        setBoards(
          res.row.content.boards.map((b, i) => ({
            id: b.id,
            name: b.name || `页面 ${i + 1}`,
            regionCount: b.regions.length,
          })),
        );
        setBoardId(res.row.content.boards[0]?.id ?? "");
      } else {
        setBoards([]);
        setBoardId("");
      }
      setBoardsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, canvasId]);

  // 选中页面 → 拉区块
  useEffect(() => {
    if (!open || canvasId === NEW_CANVAS || !boardId) {
      setRegions([]);
      setRegionId(NEW_REGION);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await getCanvas(canvasId);
      if (cancelled || !res.ok) return;
      const board = res.row.content.boards.find((b) => b.id === boardId);
      setRegions(board?.regions.map((r) => ({ id: r.id, name: r.name })) ?? []);
      setRegionId(NEW_REGION);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, canvasId, boardId]);

  const itemTitle = useMemo(() => {
    if (item.source_type === "memo") {
      return (item.excerpt || "").split("\n")[0].trim() || "空速记";
    }
    return item.title || item.url || "无标题";
  }, [item]);

  const canSubmit = !saving && (canvasId === NEW_CANVAS || (boardId !== "" && !boardsLoading));

  const submit = useCallback(async () => {
    setSaving(true);
    try {
      let targetCanvasId = canvasId;
      let content: import("@/lib/canvas/model").CanvasDoc | null = null;
      let revision = 0;

      if (canvasId === NEW_CANVAS) {
        // 新建画布：空白页面骨架（标题 + 正文区块），卡片追加到末尾
        const id = crypto.randomUUID();
        const board = createBoardShape({ x: 80, y: 80 });
        content = { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [board], freeItems: [] };
        const created = await createCanvas({
          id,
          title: itemTitle.slice(0, 50),
          content,
        });
        if (!created.ok) {
          toast({ title: "新建画布失败", description: created.reason, variant: "destructive" });
          return;
        }
        targetCanvasId = id;
        content = created.row.content;
        revision = created.row.revision;
      } else {
        const res = await getCanvas(canvasId);
        if (!res.ok) {
          toast({ title: "读取画布失败", description: "请重试", variant: "destructive" });
          return;
        }
        content = res.row.content;
        revision = res.row.revision;
      }

      const sourceRef = sourceRefFromLibraryItem(item);
      const next = appendMaterialCardToRegion(content, {
        boardId: content.boards[0]?.id ?? boardId,
        regionId: regionId === NEW_REGION ? undefined : regionId,
        title: sourceRef.title,
        text: excerptSnapshot(sourceRef.excerpt ?? ""),
        sourceRef,
      });
      const patched = await patchCanvas(targetCanvasId, {
        content: next.doc,
        expectedRevision: revision,
      });
      if (!patched.ok) {
        toast({
          title: patched.reason === "conflict" ? "画布已被其他改动更新，请重试" : "添加到画布失败",
          description: patched.reason === "invalid" ? patched.errors.join("；") : undefined,
          variant: "destructive",
        });
        return;
      }
      onOpenChange(false);
      toast({
        title: "已添加到画布",
        description: (
          <Link href={`/canvas/${targetCanvasId}`} className="underline hover:text-primary">
            打开画布查看 →
          </Link>
        ),
      });
    } finally {
      setSaving(false);
    }
  }, [canvasId, boardId, regionId, item, itemTitle, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>添加到画布</DialogTitle>
          <DialogDescription>
            「{itemTitle}」将以引用卡片快照插入画布；画布中的修改不影响原资料。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载画布列表…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">画布</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                aria-label="选择画布"
                value={canvasId}
                onChange={(e) => setCanvasId(e.target.value)}
              >
                <option value={NEW_CANVAS}>新建画布</option>
                {canvases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title || "未命名画布"}
                  </option>
                ))}
              </select>
            </label>
            {canvasId !== NEW_CANVAS && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">页面</span>
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                    aria-label="选择页面"
                    value={boardId}
                    disabled={boardsLoading}
                    onChange={(e) => setBoardId(e.target.value)}
                  >
                    {boards.map((b, i) => (
                      <option key={b.id} value={b.id}>
                        {b.name || `页面 ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">区块</span>
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                    aria-label="选择区块"
                    value={regionId}
                    onChange={(e) => setRegionId(e.target.value)}
                  >
                    <option value={NEW_REGION}>追加新区块</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                取消
              </Button>
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                添加
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 卡片行内「添加到画布」按钮 + 对话框（阻止卡片链接导航）。 */
export function AddToCanvasButton({ item }: { item: LibraryItem }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
        aria-label={`把「${item.source_type === "memo" ? (item.excerpt || "").split("\n")[0].trim() || "速记" : item.title || "资料"}」添加到画布`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        添加到画布
      </button>
      <AddToCanvasDialog item={item} open={open} onOpenChange={setOpen} />
    </>
  );
}
