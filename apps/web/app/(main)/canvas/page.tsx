"use client";

/**
 * 构思画布列表（docs/idea-canvas-plan.md §1）：新建 / 重命名 / 复制 / 软删除，
 * 按最近修改排序；空态直接给「新建构思画布」+ 双击输入的一句提示。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, LayoutTemplate, Loader2, Plus } from "@/components/icons";
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
import { CANVAS_LIST_LOAD_ERROR_MESSAGE, nextCanvasItemsAfterLoad } from "@/lib/canvas/list-load";
import { isOnline } from "@/lib/offline/network";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSearch } from "@/components/layout/page-search";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { CanvasListCard } from "@/components/canvas/canvas-list-card";
import { mutateTrash } from "@/lib/trash/client";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { toast } from "@/hooks/use-toast";

const SORT_KEY = "organize-canvas-list-sort";
const SORT_LABELS = { updated_at: "最近修改", created_at: "最近创建", title: "标题" } as const;
type Sort = keyof typeof SORT_LABELS;
function isSort(value: string | null): value is Sort { return value !== null && Object.hasOwn(SORT_LABELS, value); }

export default function CanvasListPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated_at");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SORT_KEY);
      if (isSort(stored)) setSort(stored);
    } catch { /* 存储不可用时保留默认排序 */ }
  }, []);
  const changeSort = (value: string) => {
    if (!isSort(value)) return;
    setSort(value);
    try { localStorage.setItem(SORT_KEY, value); } catch { /* 排序仍即时生效 */ }
  };
  const [items, setItems] = useState<CanvasListItem[] | null>(null);
  /** 上次成功快照的引用读取：refresh 闭包里取 previous，避免把 items 加进 deps 经 useEffect 造成重载循环 */
  const itemsRef = useRef<CanvasListItem[] | null>(null);
  /** 画布列表加载失败（在线时）：没有已加载的列表时显示错误 + 重试，而不是「还没有画布」 */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (items ?? []).filter((item) => `${item.title || "未命名画布"} ${item.summary?.excerpt ?? ""}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => sort === "title" ? (a.title || "未命名画布").localeCompare(b.title || "未命名画布", "zh-CN") : b[sort].localeCompare(a[sort]));
  }, [items, query, sort]);

  const refresh = useCallback(async () => {
    // listCanvases 失败返回 null：不得吞成空数组伪装成「还没有画布」，交给纯函数保留上次快照并产出错误文案；
    // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
    const plan = nextCanvasItemsAfterLoad({ previous: itemsRef.current, list: await listCanvases() });
    itemsRef.current = plan.items;
    setItems(plan.items);
    setLoadError(plan.loadError);
    if (plan.loadError && isOnline()) {
      toast({ title: CANVAS_LIST_LOAD_ERROR_MESSAGE, variant: "destructive" });
    }
  }, []);

  /** 首屏失败后的重试：清错后重新拉取（清掉后会短暂回到「加载中…」） */
  const retry = useCallback(() => {
    setLoadError(null);
    void refresh();
  }, [refresh]);

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
      if (!row.ok) { toast({ title: "画布读取失败，请重试", variant: "destructive" }); return; }
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
        if (!row.ok) { toast({ title: "画布读取失败，请重试", variant: "destructive" }); return; }
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
          let restoring = false;
          const notice = toast({
            title: "已移入垃圾箱",
            action: <Button size="sm" variant="outline" onClick={() => {
              if (restoring) return;
              restoring = true;
              void (async () => {
                try {
                  const affected = await mutateTrash("canvas_document", [item.id], "restore");
                  if (!affected) throw new Error("画布未恢复");
                  notice.dismiss();
                  toast({ title: "已恢复画布" });
                  await refresh();
                } catch {
                  toast({ title: "恢复失败，请在垃圾箱重试", variant: "destructive" });
                } finally { restoring = false; }
              })();
            }}>撤销</Button>,
          });
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
      <PageHeader
        title="构思画布"
        className="mb-4"
        search={<PageSearch value={query} onChange={setQuery} placeholder="搜索画布标题和摘要" liveHint={items ? `${visibleItems.length} 张画布` : undefined} />}
        actions={<>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" aria-label={`画布排序：${SORT_LABELS[sort]}`}><ArrowUpDown className="mr-2 h-4 w-4" />{SORT_LABELS[sort]}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={sort} onValueChange={changeSort}>
                {Object.entries(SORT_LABELS).map(([value, label]) => <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => void create()} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}新建构思画布
          </Button>
        </>}
      />

      {/* 加载失败不得伪装成「还没有画布」：无快照给错误块 + 重试，有快照保留列表 + 行内提示 */}
      {items === null ? (
        loadError ? (
          <EmptyState
            icon={LayoutTemplate}
            title={CANVAS_LIST_LOAD_ERROR_MESSAGE}
            action={<Button variant="outline" onClick={retry}>重试</Button>}
          />
        ) : (
          <div role="status" aria-label="正在加载画布" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="canvas-list-card motion-safe:animate-pulse" aria-hidden="true">
              <div className="canvas-list-thumbnail" />
              <div className="canvas-list-info"><div className="h-5 w-2/3 rounded bg-muted" /><div className="h-4 w-1/2 rounded bg-muted" /><div className="h-4 w-full rounded bg-muted" /><div className="h-4 w-1/3 rounded bg-muted" /></div>
            </div>)}
          </div>
        )
      ) : items.length === 0 ? (
        loadError ? (
          <EmptyState
            icon={LayoutTemplate}
            title={CANVAS_LIST_LOAD_ERROR_MESSAGE}
            action={<Button variant="outline" onClick={retry}>重试</Button>}
          />
        ) : (
          <EmptyState
            icon={LayoutTemplate}
            title="还没有画布"
            description="把想法写下来，让版式自己长出来：双击画布空白处即可开始输入。"
            action={
              <Button onClick={() => void create()} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                新建构思画布
              </Button>
            }
          />
        )
      ) : (
        <>
          {/* toast 会消失：保留旧列表时加载失败要有持久的行内提示 + 就地重试（与 countdown 页同款） */}
          {loadError && (
            <div
              className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2"
              role="alert"
            >
              <p className="text-xs text-destructive">{CANVAS_LIST_LOAD_ERROR_MESSAGE}</p>
              <Button size="sm" variant="outline" className="shrink-0" onClick={retry}>
                重试
              </Button>
            </div>
          )}
          {visibleItems.length === 0 ? (
            <EmptyState icon={LayoutTemplate} title="没有匹配的画布" description="试试其他标题或摘要关键词。" action={<Button variant="outline" onClick={() => setQuery("")}>清除搜索</Button>} />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleItems.map((item) => <CanvasListCard key={item.id} item={item} busy={busyId === item.id}
                onOpen={() => router.push(`/canvas/${item.id}`)} onRename={() => void rename(item)} onDuplicate={() => void duplicate(item)} onRemove={() => void remove(item)} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
