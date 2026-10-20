"use client";

/**
 * 资料库「添加到画布」（阶段 E）：选择现有画布（或新建）→ 页面 → 区块，
 * 把资料以引用卡片快照追加到该区块末尾（appendMaterialCardToRegion，
 * 一次 PATCH 事务；冲突 409 如实报错不静默覆盖）。
 * 插入后可在画布中继续编辑快照，原资料不受影响。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  CANVAS_LIST_LOAD_ERROR_MESSAGE,
  nextCanvasItemsAfterLoad,
} from "@/lib/canvas/list-load";
import {
  CANVAS_BOARDS_LOAD_ERROR_MESSAGE,
  nextBoardsAfterLoad,
} from "@/lib/canvas/boards-load";
import { isOnline } from "@/lib/offline/network";
import { createBoardShape, CANVAS_SCHEMA_VERSION, type CanvasDoc, type CanvasBoard } from "@/lib/canvas/model";
import { excerptSnapshot, sourceRefFromLibraryItem } from "@/lib/library/material-source";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, Loader2 } from "@/components/icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { formatTimeAgo } from "@/lib/date-utils";
import { createClient } from "@/lib/supabase/client";
import { NEW_CANVAS, NEW_REGION, readCanvasAddTarget, rememberCanvasAddTarget, resolveCanvasAddTarget, type CanvasAddTarget } from "@/lib/canvas/add-target-memory";
import { hasMaterialCard, MATERIAL_ADD_ERROR, MATERIAL_ADD_SUCCESS } from "@/lib/canvas/material-feedback";
import { toast } from "@/hooks/use-toast";

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
  /** 上次成功快照：刷新失败时原样保留（effect 闭包读不到最新 state） */
  const canvasesRef = useRef<CanvasListItem[]>([]);
  /** 画布列表加载失败：没有已加载的列表时显示错误 + 重试，而不是伪装成「只有新建画布」 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 重试计数：自增让下方 effect 重新 listCanvases */
  const [reloadCount, setReloadCount] = useState(0);
  const [boards, setBoards] = useState<CanvasBoard[]>([]);
  /** 上次成功的页面快照，带所属 canvasId：换画布后旧画布的页面不得当作新画布的快照 */
  const boardsRef = useRef<{ canvasId: string; boards: CanvasBoard[] }>({ canvasId: "", boards: [] });
  /** 页面加载失败：与画布列表的 loadError 独立，两跳各自诚实；不得把失败伪装成「该画布没有页面」 */
  const [boardsLoadError, setBoardsLoadError] = useState<string | null>(null);
  /** 页面重试计数：自增让下方 effect 重新 getCanvas */
  const [boardsReloadCount, setBoardsReloadCount] = useState(0);
  const [loadedCanvas, setLoadedCanvas] = useState<{ id: string; doc: CanvasDoc } | null>(null);
  const remembered = useRef<CanvasAddTarget | null>(null);
  const userIdRef = useRef("");
  const submitting = useRef(false);
  const [canvasPickerOpen, setCanvasPickerOpen] = useState(false);
  const [canvasId, setCanvasId] = useState<string>(NEW_CANVAS);
  const [boardId, setBoardId] = useState<string>("");
  const [regionId, setRegionId] = useState<string>(NEW_REGION);
  const [loading, setLoading] = useState(false);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentTarget = useRef({ boardId, regionId });
  currentTarget.current = { boardId, regionId };

  useEffect(() => {
    if (!open) return;
    setCanvasId(NEW_CANVAS);
    setBoardId("");
    setRegionId(NEW_REGION);
    setLoadedCanvas(null);
    setCanvasPickerOpen(false);
    remembered.current = null;
    userIdRef.current = "";
  }, [open]);

  // 打开时拉画布列表
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      const [list, uid] = await Promise.all([
        listCanvases(),
        createClient().auth.getUser().then(({ data }) => data.user?.id ?? "").catch(() => ""),
      ]);
      if (cancelled) return;
      // listCanvases 失败返回 null：不得吞成空数组伪装成「还没有画布」，交给纯函数保留上次快照并产出错误文案；
      // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
      const plan = nextCanvasItemsAfterLoad({ previous: canvasesRef.current, list });
      canvasesRef.current = plan.items ?? [];
      setCanvases(plan.items ?? []);
      setLoadError(plan.loadError);
      if (plan.loadError && isOnline()) {
        toast({ title: CANVAS_LIST_LOAD_ERROR_MESSAGE, variant: "destructive" });
      }
      userIdRef.current = uid;
      const target = readCanvasAddTarget(uid);
      remembered.current = target;
      if (list !== null) {
        const restoredId = list.some((c) => c.id === target?.canvasId) ? target!.canvasId : NEW_CANVAS;
        setCanvasId((current) => list.some((c) => c.id === current) ? current : restoredId);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reloadCount]);

  /** 首屏失败后的重试：清错后重新拉取（清掉后会短暂回到「加载画布列表…」） */
  const retryLoadCanvases = () => {
    setLoadError(null);
    setReloadCount((count) => count + 1);
  };

  // 选中现有画布 → 拉页面（区块数）
  useEffect(() => {
    if (!open || canvasId === NEW_CANVAS) {
      boardsRef.current = { canvasId: "", boards: [] };
      setBoards([]);
      setBoardId("");
      setBoardsLoadError(null);
      setBoardsLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setBoardsLoading(true);
      setBoardsLoadError(null);
      const res = await getCanvas(canvasId);
      if (cancelled) return;
      // 只有同一画布的上次成功结果才算快照；换画布时 previous 为空，失败就走「错误 + 重试」而非沿用旧画布页面
      const previous = boardsRef.current.canvasId === canvasId ? boardsRef.current.boards : [];
      // getCanvas 失败不得吞成空数组伪装成「该画布没有页面」，交给纯函数保留快照并产出错误文案
      const plan = res.ok
        ? nextBoardsAfterLoad({
            previous,
            ok: true,
            boards: res.row.content.boards,
          })
        : nextBoardsAfterLoad({ previous, ok: false });
      boardsRef.current = { canvasId, boards: plan.boards };
      setBoards(plan.boards);
      setBoardsLoadError(plan.loadError);
      if (res.ok) {
        setLoadedCanvas({ id: canvasId, doc: res.row.content });
        const previousTarget = remembered.current?.canvasId === canvasId ? remembered.current : null;
        // Retries retain the current target; memory is consumed only after successful validation.
        const resolved = resolveCanvasAddTarget(plan.boards, previousTarget ?? currentTarget.current);
        setBoardId(resolved.boardId);
        setRegionId(resolved.regionId);
        if (previousTarget) remembered.current = null;
      }
      // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
      if (plan.loadError && isOnline()) {
        toast({ title: CANVAS_BOARDS_LOAD_ERROR_MESSAGE, variant: "destructive" });
      }
      setBoardsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, canvasId, boardsReloadCount]);

  /** 页面加载失败后的重试：清错后重新拉取当前画布的 getCanvas */
  const retryLoadBoards = () => {
    setBoardsLoadError(null);
    setBoardsReloadCount((count) => count + 1);
  };

  const selectedBoard = boards.find((board) => board.id === boardId);
  const regions = selectedBoard?.regions ?? [];
  const sortedCanvases = useMemo(() => [...canvases].sort((a, b) =>
    (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0)), [canvases]);
  const selectedCanvas = canvases.find((canvas) => canvas.id === canvasId);
  const duplicate = loadedCanvas?.id === canvasId && hasMaterialCard(loadedCanvas.doc, { kind: item.source_type, id: item.id });
  const chooseCanvas = (id: string) => {
    setCanvasPickerOpen(false);
    if (id === canvasId) return;
    remembered.current = null;
    setCanvasId(id);
    setBoards([]);
    setBoardId("");
    setRegionId(NEW_REGION);
    setLoadedCanvas(null);
    setBoardsLoading(id !== NEW_CANVAS);
  };

  const itemTitle = useMemo(() => {
    if (item.source_type === "memo") {
      return (item.excerpt || "").split("\n")[0].trim() || "空速记";
    }
    return item.title || item.url || "无标题";
  }, [item]);

  const canSubmit = !saving && !loading && !(loadError && canvases.length === 0)
    && (canvasId === NEW_CANVAS || (boardId !== "" && !boardsLoading && loadedCanvas?.id === canvasId));

  const submit = useCallback(async () => {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
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
          toast({ title: MATERIAL_ADD_ERROR, description: "新建画布失败，请重试", variant: "destructive" });
          return;
        }
        targetCanvasId = id;
        content = created.row.content;
        revision = created.row.revision;
      } else {
        const res = await getCanvas(canvasId);
        if (!res.ok) {
          toast({ title: MATERIAL_ADD_ERROR, description: "读取画布失败，请重试", variant: "destructive" });
          return;
        }
        content = res.row.content;
        revision = res.row.revision;
      }

      const targetBoardId = canvasId === NEW_CANVAS ? content.boards[0]?.id : boardId;
      const targetBoard = content.boards.find((board) => board.id === targetBoardId);
      if (!targetBoard || (canvasId !== NEW_CANVAS && regionId !== NEW_REGION && !targetBoard.regions.some((r) => r.id === regionId))) {
        toast({ title: MATERIAL_ADD_ERROR, description: "目标页面或区块已不存在，请重新选择", variant: "destructive" });
        setBoardsReloadCount((count) => count + 1);
        return;
      }
      const sourceRef = sourceRefFromLibraryItem(item);
      const next = appendMaterialCardToRegion(content, {
        boardId: targetBoard.id,
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
          title: MATERIAL_ADD_ERROR,
          description: patched.reason === "conflict" ? "画布已被其他改动更新，请重试" : patched.reason === "invalid" ? patched.errors.join("；") : "请重试",
          variant: "destructive",
        });
        return;
      }
      const focus = next.focus;
      if (focus?.kind !== "block") return;
      rememberCanvasAddTarget(userIdRef.current, { canvasId: targetCanvasId, boardId: focus.boardId, regionId: focus.regionId });
      onOpenChange(false);
      toast({
        title: MATERIAL_ADD_SUCCESS,
        description: (
          <Link href={`/canvas/${targetCanvasId}?focus=${encodeURIComponent(focus.blockId)}`} className="underline hover:text-primary">
            打开画布查看 →
          </Link>
        ),
      });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }, [canSubmit, canvasId, boardId, regionId, item, itemTitle, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 grid-cols-[minmax(0,1fr)] sm:max-w-[420px]" onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
        // Enter in a picker chooses an option; buttons retain their native keyboard action.
        if ((event.target as HTMLElement).closest("button, [role='combobox'], [role='listbox'], [cmdk-root]")) return;
        event.preventDefault();
        void submit();
      }}>
        <DialogHeader className="min-w-0">
          <DialogTitle>添加到画布</DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            「{itemTitle}」将以引用卡片快照插入画布；画布中的修改不影响原资料。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载画布列表…
          </p>
        ) : loadError && canvases.length === 0 ? (
          /* 加载失败不得伪装成「只有新建画布」：无快照给错误态 + 重试 */
          <div className="flex flex-col items-center gap-3 py-8" role="alert">
            <p className="text-sm text-destructive">{CANVAS_LIST_LOAD_ERROR_MESSAGE}</p>
            <Button size="sm" variant="outline" onClick={retryLoadCanvases}>
              重试
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {/* 刷新失败但已有列表：保留下拉（含旧快照）+ 持久行内提示 + 就地重试（toast 会消失） */}
            {loadError && (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
                role="alert"
              >
                <span className="text-xs text-destructive">{loadError}</span>
                <Button size="sm" variant="outline" onClick={retryLoadCanvases}>
                  重试
                </Button>
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="text-muted-foreground">画布</span>
              <Popover open={canvasPickerOpen} onOpenChange={setCanvasPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-label="选择画布" aria-expanded={canvasPickerOpen} className="w-full min-w-0 justify-between font-normal">
                    <span className="truncate">{canvasId === NEW_CANVAS ? "新建画布" : selectedCanvas?.title || "未命名画布"}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="z-[70] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0">
                  <Command label="搜索画布" tabIndex={canvases.length > 6 ? -1 : 0} onKeyDownCapture={(e) => {
                    if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) {
                      e.preventDefault(); e.stopPropagation();
                    }
                  }}>
                    {canvases.length > 6 && <CommandInput aria-label="搜索画布" placeholder="搜索画布…" />}
                    <CommandList>
                      <CommandEmpty>没有匹配的画布</CommandEmpty>
                      <CommandGroup>
                        <CommandItem value={NEW_CANVAS} forceMount onSelect={() => chooseCanvas(NEW_CANVAS)}>
                          <Check className={`mr-2 h-4 w-4 shrink-0 ${canvasId === NEW_CANVAS ? "" : "invisible"}`} />新建画布
                        </CommandItem>
                        {sortedCanvases.map((canvas) => (
                          <CommandItem key={canvas.id} value={canvas.id} keywords={[canvas.title || "未命名画布"]} onSelect={() => chooseCanvas(canvas.id)}>
                            <Check className={`mr-2 h-4 w-4 shrink-0 ${canvasId === canvas.id ? "" : "invisible"}`} />
                            <span className="min-w-0 flex-1 truncate">{canvas.title || "未命名画布"}</span>
                            <span className="ml-2 shrink-0 text-xs text-muted-foreground">{formatTimeAgo(canvas.updated_at)}更新</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {canvasId !== NEW_CANVAS && (
              <>
                {boardsLoadError && boards.length === 0 ? (
                  /* 页面加载失败且无快照：错误 + 重试，不得只渲染空下拉伪装成「该画布没有页面」 */
                  <div
                    className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
                    role="alert"
                  >
                    <span className="text-xs text-destructive">{boardsLoadError}</span>
                    <Button size="sm" variant="outline" onClick={retryLoadBoards}>
                      重试
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* 刷新失败但已有页面快照：保留下拉 + 持久行内提示 + 就地重试（toast 会消失） */}
                    {boardsLoadError && (
                      <div
                        className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
                        role="alert"
                      >
                        <span className="text-xs text-destructive">{boardsLoadError}</span>
                        <Button size="sm" variant="outline" onClick={retryLoadBoards}>
                          重试
                        </Button>
                      </div>
                    )}
                    <div className="flex min-w-0 flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">页面</span>
                      <Select value={boardId} disabled={boardsLoading || boards.length === 0} onValueChange={(id) => { setBoardId(id); setRegionId(NEW_REGION); }}>
                        <SelectTrigger aria-label="选择页面" className="min-w-0"><SelectValue placeholder={boardsLoading ? "加载画布页面…" : "没有可用页面"} /></SelectTrigger>
                        <SelectContent className="z-[70] max-w-[calc(100vw-2rem)]">{boards.map((b, i) => <SelectItem key={b.id} value={b.id}>{b.name || `页面 ${i + 1}`}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">区块</span>
                  <Select value={regionId} disabled={boardsLoading || !selectedBoard} onValueChange={setRegionId}>
                    <SelectTrigger aria-label="选择区块" className="min-w-0"><SelectValue /></SelectTrigger>
                    <SelectContent className="z-[70] max-w-[calc(100vw-2rem)]">
                      <SelectItem value={NEW_REGION}>追加新区块</SelectItem>
                      {regions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name || "未命名区块"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <p className="break-words text-xs text-muted-foreground [overflow-wrap:anywhere]" aria-live="polite">
              将添加到：{canvasId === NEW_CANVAS ? `${itemTitle.slice(0, 50)}（新建画布） › 页面 1 › 新区块`
                : `${selectedCanvas?.title || "未命名画布"} › ${selectedBoard ? selectedBoard.name || `页面 ${boards.indexOf(selectedBoard) + 1}` : "待选择页面"} › ${regionId === NEW_REGION ? "新区块" : regions.find((r) => r.id === regionId)?.name || "未命名区块"}`} 末尾
            </p>
            {duplicate && <p className="text-xs text-muted-foreground" role="note">此画布已有这条资料的卡片</p>}
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
