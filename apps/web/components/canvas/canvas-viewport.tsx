"use client";

/**
 * 无限画布视口（docs/idea-canvas-plan.md §6.2）。
 *
 * - 坐标换算 world = (client − viewportRect − pan) / zoom，不写死侧栏/页头偏移；
 * - Ctrl/Meta+滚轮围绕指针缩放（10%–400%），滚轮/触控板平移，空格或中键拖拽平移；
 * - 触屏：空白处单指平移；只读时按在内容上也可平移；双指以中点为锚缩放并跟随平移；
 * - 双击空白在指针世界坐标建版面；文本编辑期间不拦截空格/方向键，输入框不参与触屏手势。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CanvasDoc } from "@/lib/canvas/model";
import { createBoardSkeleton } from "@/lib/canvas/commands";
import { shouldPasteInternalClipboard } from "@/lib/canvas/clipboard";
import type { SelectionBounds } from "@/lib/canvas/selection-bounds";
import { sceneBounds, type Scene } from "@/lib/canvas/layout";
import { screenToWorld, worldToScreen as toScreen } from "@/lib/canvas/coords";
import { groupBounds } from "@/lib/canvas/free-selection";
import { snapTargetsForItem, type SnapGuide, type SnapRect } from "@/lib/canvas/snap";
import type { ExplicitInsertPosition } from "@/lib/canvas/insert-target";
import { hasOpenDialog } from "@/lib/hooks/use-hotkey";
import { hitTestInsertPosition } from "./canvas-hit-test";
import { commitCanvasPaste } from "./canvas-clipboard-actions";
import { isNativeEditTarget, resolveCanvasContextTarget, selectionForContextTarget, type CanvasContextMenuPoint } from "./canvas-context-menu";
import type { CanvasStore } from "./canvas-store";
import type { SourceStatusMap } from "./use-source-status";
import { CanvasBoardView } from "./canvas-board";
import { useCanvasPointer } from "./use-canvas-pointer";
import { useCanvasTouch } from "./use-canvas-touch";
import { CanvasFreeItemView } from "./canvas-free-item";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

/** 无吸附候选时共享同一空数组（避免每次渲染新引用击穿 memo）。 */
const EMPTY_SNAP_TARGETS: SnapRect[] = [];

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** 世界坐标 → 屏幕坐标（视口内相对坐标）。 */
export function worldToScreen(wx: number, wy: number, vp: { x: number; y: number; zoom: number }) {
  return toScreen(wx, wy, vp);
}

export interface CanvasViewportProps {
  store: CanvasStore;
  doc: CanvasDoc;
  scene: Scene;
  userId: string;
  /** 外层标记：编辑器（可双击建版面）或只读预览。 */
  interactive: boolean;
  /** 空格键按住状态（由工作区键盘监听维护）。 */
  spaceHeld: boolean;
  /** 由工作区订阅后传入（保证选中/编辑态变化触发重渲染）。 */
  selection: ReturnType<CanvasStore["getState"]>["selection"];
  editingBlockId: string | null;
  assetUrls: Record<string, string>;
  /** 资料来源可达性（E）。 */
  sourceStatuses: SourceStatusMap;
  /** B1 空态明确入口：新建空白页面 / 宣传落地页骨架。 */
  onCreateBlank?: () => void;
  onCreateLanding?: () => void;
  /** 图片替换（B2 统一上传入口）。 */
  onReplaceImage?: (blockId: string, file: File) => void;
  /**
   * 拖入/粘贴文件（B2）：explicit = 指针命中的列/区块（可能为 null = 走常规解析），
   * at = 指针世界坐标（空白处落文件时可就地建页面）。
   */
  onInsertFiles?: (
    files: File[],
    explicit: ExplicitInsertPosition | null,
    at: { x: number; y: number },
  ) => void;
  /** 右键模块、自由元素、区块、版面或画布空白。文本编辑目标不调用。 */
  onOpenContextMenu?: (point: CanvasContextMenuPoint) => void;
}

export function CanvasViewportView({
  store,
  doc,
  scene,
  userId,
  interactive,
  spaceHeld,
  selection,
  editingBlockId,
  assetUrls,
  sourceStatuses,
  onCreateBlank,
  onCreateLanding,
  onReplaceImage,
  onInsertFiles,
  onOpenContextMenu,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const vp = useStoreViewport(store);
  const pointer = useCanvasPointer(store, scene, interactive, spaceHeld);
  const touch = useCanvasTouch(store, interactive, () => pointer.cancel());
  /** 最近一次指针在视口内的世界坐标（粘贴落点用）。 */
  const lastPointerWorldRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  /** 指针是否还在视口内。离开后键盘粘贴改走原位偏移，图片粘贴仍用上次坐标。 */
  const pointerInsideRef = useRef(false);
  /** 自由元素拖动中的对齐参考线（世界坐标）。 */
  const [snapGuides, setSnapGuides] = useState<SnapGuide[] | null>(null);
  const onSnapGuides = useCallback((guides: SnapGuide[] | null) => setSnapGuides(guides), []);
  /** 多选自由元素拖动时的共用位移。 */
  const [groupLive, setGroupLive] = useState<{ dx: number; dy: number } | null>(null);
  const onGroupLive = useCallback((live: { dx: number; dy: number } | null) => setGroupLive(live), []);
  const selectedFreeIds = selection?.kind === "free" ? [selection.itemId]
    : selection?.kind === "frees" ? selection.itemIds : [];
  const snapTargetsFor = useCallback(
    (excludeIds: readonly string[]) => snapTargetsForItem(scene, excludeIds),
    [scene],
  );
  const getGroupMembers = useCallback(() => {
    const live = store.getState().selection;
    const ids = live?.kind === "free" ? [live.itemId] : live?.kind === "frees" ? live.itemIds : [];
    if (ids.length < 2) return null;
    const members = ids.flatMap((id) => {
      const item = doc.freeItems.find((entry) => entry.id === id);
      const box = scene.freeItems.find((entry) => entry.itemId === id);
      return item && box ? [{ id, x: item.x, y: item.y, width: item.width, height: box.height }] : [];
    });
    return members.length > 1 ? members : null;
  }, [doc.freeItems, scene.freeItems, store]);
  /** 每个自由元素的吸附候选（其他自由元素 + 全部页面；随场景重算）。 */
  const snapTargetsByItem = useMemo(() => {
    const map = new Map<string, SnapRect[]>();
    for (const item of scene.freeItems) map.set(item.itemId, snapTargetsForItem(scene, item.itemId));
    return map;
  }, [scene]);

  // ---- 缩放与平移 ----

  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const state = store.getState();
      const { zoom } = state.viewport;
      const nextZoom = clampZoom(zoom * factor);
      if (nextZoom === zoom) return;
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const before = screenToWorld(clientX, clientY, rect, state.viewport);
      store.getState().setViewport({
        zoom: nextZoom,
        x: relX - before.x * nextZoom,
        y: relY - before.y * nextZoom,
      });
    },
    [store],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // React delegates wheel passively; a native active listener must cancel browser gestures.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
      else {
        const live = store.getState().viewport;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
        store.getState().setViewport({ x: live.x - e.deltaX * unit, y: live.y - e.deltaY * unit });
      }
    };
    let lastScale = 1;
    const gesture = (event: Event) => {
      event.preventDefault();
      // 触屏双指已经按指针捏合处理；这里留给 Safari 触控板 gesture。
      if (touch.pinchingRef.current) return;
      const e = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (e.type === "gesturestart") lastScale = 1;
      if (e.type === "gesturechange" && e.scale && e.scale > 0) {
        const rect = el.getBoundingClientRect();
        const x = e.clientX !== undefined && e.clientX >= rect.left && e.clientX <= rect.right ? e.clientX : rect.left + rect.width / 2;
        const y = e.clientY !== undefined && e.clientY >= rect.top && e.clientY <= rect.bottom ? e.clientY : rect.top + rect.height / 2;
        zoomAt(e.scale / lastScale, x, y);
        lastScale = e.scale;
      }
    };
    const oldOverscroll = document.documentElement.style.overscrollBehaviorX;
    document.documentElement.style.overscrollBehaviorX = "none";
    el.addEventListener("wheel", wheel, { passive: false });
    for (const name of ["gesturestart", "gesturechange", "gestureend"]) el.addEventListener(name, gesture, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      for (const name of ["gesturestart", "gesturechange", "gestureend"]) el.removeEventListener(name, gesture);
      document.documentElement.style.overscrollBehaviorX = oldOverscroll;
    };
  }, [store, touch.pinchingRef, zoomAt]);

  const beginPan = useCallback(
    (e: ReactPointerEvent) => {
      if (!spaceHeld && e.button !== 1) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: store.getState().viewport.x,
        originY: store.getState().viewport.y,
      };
      setPanning(true);
    },
    [spaceHeld, store],
  );

  const onPanMove = useCallback(
    (e: ReactPointerEvent) => {
      const pan = panRef.current;
      if (!pan) return;
      store.getState().setViewport({
        x: pan.originX + (e.clientX - pan.startX),
        y: pan.originY + (e.clientY - pan.startY),
      });
    },
    [store],
  );

  const endPan = useCallback((e: ReactPointerEvent) => {
    if (!panRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    panRef.current = null;
    setPanning(false);
  }, []);

  // ---- 双击建页面骨架（含 50%/100%/200% 下的世界坐标换算，A01；B1 改走 blank 骨架） ----

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!interactive) return;
      // 只响应空白处：目标必须是视口或世界容器本身
      const target = e.target as HTMLElement;
      if (!target.classList.contains("canvas-viewport") && !target.classList.contains("canvas-world")) {
        return;
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const at = screenToWorld(e.clientX, e.clientY, rect, store.getState().viewport);
      store.getState().apply("新建空白页面", (d) =>
        createBoardSkeleton(d, { at, variant: "blank" }),
      );
    },
    [interactive, store],
  );

  /** 指针世界坐标（相对视口 rect）。 */
  const pointerWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return screenToWorld(clientX, clientY, rect, store.getState().viewport);
  }, [store]);

  // ---- 拖入 / 粘贴图片（B2 统一图片入口：指针命中列/区块 → explicit 目标） ----

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!interactive || !onInsertFiles) return;
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    [interactive, onInsertFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!interactive || !onInsertFiles) return;
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      const at = pointerWorld(e.clientX, e.clientY);
      if (!at) return;
      const explicit = hitTestInsertPosition(doc, scene, at.x, at.y);
      lastPointerWorldRef.current = at;
      onInsertFiles(files, explicit, at);
    },
    [interactive, onInsertFiles, pointerWorld, doc, scene],
  );

  const rememberPointer = useCallback((clientX: number, clientY: number) => {
    const at = pointerWorld(clientX, clientY);
    if (!at) return null;
    lastPointerWorldRef.current = at;
    pointerInsideRef.current = true;
    return at;
  }, [pointerWorld]);

  // 挂在 window 上：e2e 把 paste 派发到视口且会冒泡。不要再同时绑 React onPaste，否则图片会插入两次。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!interactive || hasOpenDialog() || isNativeEditTarget(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (files.length > 0) {
        if (!onInsertFiles) return;
        e.preventDefault();
        const at = lastPointerWorldRef.current;
        onInsertFiles(files, hitTestInsertPosition(doc, scene, at.x, at.y), at);
        return;
      }
      let text = "";
      try {
        text = e.clipboardData?.getData("text/plain") ?? "";
      } catch {
        text = "";
      }
      if (!shouldPasteInternalClipboard(text) && !text.trim()) return;
      e.preventDefault();
      const pointer = pointerInsideRef.current ? lastPointerWorldRef.current : null;
      commitCanvasPaste(store, {
        pointer,
        explicit: pointer ? hitTestInsertPosition(doc, scene, pointer.x, pointer.y) : null,
        systemText: text,
      });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [doc, interactive, onInsertFiles, scene, store]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    const hit = resolveCanvasContextTarget(e.target);
    if (hit.kind === "native") return;
    e.preventDefault();
    const at = rememberPointer(e.clientX, e.clientY) ?? lastPointerWorldRef.current;
    if (hit.kind !== "canvas") {
      store.getState().select(selectionForContextTarget(store.getState().selection, hit));
    }
    onOpenContextMenu?.({
      x: e.clientX,
      y: e.clientY,
      world: at,
      scope: hit.kind === "canvas" ? "canvas" : "element",
    });
  }, [onOpenContextMenu, rememberPointer, store]);

  const onPointerDownBackground = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      // 点空白清除选区（拖块/容器的事件已 stopPropagation 不会到这里）
      const target = e.target as HTMLElement;
      if (target.classList.contains("canvas-viewport") || target.classList.contains("canvas-world")) {
        store.getState().select(null);
        store.getState().stopEdit();
      }
    },
    [store],
  );

  return (
    <div
      ref={viewportRef}
      className={`canvas-viewport ${interactive ? "is-editable" : ""} ${spaceHeld || panning || touch.navigating ? "is-panning" : ""}`}
      data-testid="canvas-viewport"
      style={{
        backgroundSize: `${24 * vp.zoom}px ${24 * vp.zoom}px`,
        backgroundPosition: `${vp.x}px ${vp.y}px`,
      }}
      onPointerDownCapture={(e) => {
        if (touch.onPointerDown(e)) return;
        pointer.down(e);
      }}
      onPointerMoveCapture={(e) => {
        touch.onPointerMove(e);
        pointer.move(e);
      }}
      onClickCapture={(e) => {
        pointer.clickCapture(e);
        touch.onClickCapture(e);
      }}
      onPointerDown={(e) => {
        beginPan(e);
        onPointerDownBackground(e);
      }}
      onPointerEnter={(e) => { rememberPointer(e.clientX, e.clientY); }}
      onPointerLeave={() => { pointerInsideRef.current = false; }}
      onPointerMove={(e) => {
        rememberPointer(e.clientX, e.clientY);
        onPanMove(e);
      }}
      onPointerUp={(e) => {
        const owned = touch.owns(e.pointerId);
        touch.onPointerUp(e);
        pointer.finish(e);
        endPan(e);
        if (owned) touch.release(e);
      }}
      onPointerCancel={(e) => {
        const owned = touch.owns(e.pointerId);
        touch.onPointerCancel(e);
        pointer.finish(e, true);
        endPan(e);
        if (owned) touch.release(e);
      }}
      onLostPointerCapture={(e) => {
        pointer.finish(e, true);
        // 子元素放开自己的捕获时事件会冒泡上来，不能据此结束正在进行的捏合。
        if (e.target === e.currentTarget) touch.onPointerCancel(e);
        endPan(e);
      }}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <div
        className="canvas-world"
        style={{
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {doc.boards.map((board) => {
          const sceneBoard = scene.boards.find((b) => b.boardId === board.id);
          if (!sceneBoard) return null;
          return (
            <CanvasBoardView
              key={board.id}
              board={board}
              sceneBoard={sceneBoard}
              store={store}
              zoom={vp.zoom}
              interactive={interactive}
              userId={userId}
              assetUrls={assetUrls}
              selectedBoard={selection?.kind === "board" && selection.boardId === board.id}
              selectedRegion={
                selection?.kind === "region" && selection.boardId === board.id
                  ? selection
                  : null
              }
              selectedBlockIds={selection?.kind === "block" ? [selection.blockId] : selection?.kind === "blocks" ? selection.blockIds : []}
              editingBlockId={editingBlockId}
              sourceStatuses={sourceStatuses}
              onReplaceImage={onReplaceImage}
            />
          );
        })}
        {doc.freeItems.map((item) => {
          const box = scene.freeItems.find((box) => box.itemId === item.id);
          if (!box) return null;
          const grouped = selectedFreeIds.length > 1 && selectedFreeIds.includes(item.id);
          return (
            <CanvasFreeItemView
              key={item.id}
              item={item}
              height={box.height}
              store={store}
              zoom={vp.zoom}
              interactive={interactive}
              selected={selectedFreeIds.includes(item.id)}
              grouped={grouped}
              editing={editingBlockId === item.id}
              userId={userId}
              assetUrls={assetUrls}
              snapTargets={snapTargetsByItem.get(item.id) ?? EMPTY_SNAP_TARGETS}
              snapTargetsFor={snapTargetsFor}
              getGroupMembers={getGroupMembers}
              groupLive={grouped ? groupLive : null}
              onGroupLive={onGroupLive}
              onSnapGuides={onSnapGuides}
            />
          );
        })}
        {(() => {
          if (selectedFreeIds.length < 2) return null;
          const rects = scene.freeItems.filter((box) => selectedFreeIds.includes(box.itemId)).map((box) => ({
            x: box.x + (groupLive?.dx ?? 0),
            y: box.y + (groupLive?.dy ?? 0),
            width: box.width,
            height: box.height,
          }));
          const frame = rects.length > 1 ? groupBounds(rects) : null;
          if (!frame) return null;
          return (
            <div
              className="canvas-selection-marquee canvas-free-group"
              style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
              aria-hidden="true"
            >
              <span className="canvas-free-badge" aria-label="自由定位元素">自由定位</span>
            </div>
          );
        })()}
        {pointer.visual?.marquee && <div className="canvas-selection-marquee" style={{ left: pointer.visual.marquee.x, top: pointer.visual.marquee.y, width: pointer.visual.marquee.width, height: pointer.visual.marquee.height }} />}
        {pointer.visual?.ghosts?.map((box) => <div key={box.blockId} className="canvas-selection-marquee" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} />)}
        {pointer.visual?.drop && <div className="canvas-drop-indicator" style={{ left: pointer.visual.drop.x, top: pointer.visual.drop.y, width: pointer.visual.drop.width }} />}
        {interactive && snapGuides?.map((guide, index) => (
          guide.axis === "x" ? (
            <div
              key={`snap-x-${index}`}
              className="canvas-snap-guide"
              style={{ left: guide.pos, top: guide.from, width: 1 / vp.zoom, height: guide.to - guide.from }}
            />
          ) : (
            <div
              key={`snap-y-${index}`}
              className="canvas-snap-guide"
              style={{ top: guide.pos, left: guide.from, height: 1 / vp.zoom, width: guide.to - guide.from }}
            />
          )
        ))}
      </div>
      {pointer.visual?.hint && <div className="canvas-drag-hint" role="status">{pointer.visual.hint}</div>}
      {interactive && doc.boards.length === 0 && doc.freeItems.length === 0 && (
        <div className="canvas-empty-hint">
          <p>双击画布任意位置，开始你的第一张构思稿</p>
          {(onCreateBlank || onCreateLanding) && (
            <div className="canvas-empty-actions">
              {onCreateBlank && (
                <button
                  type="button"
                  className="canvas-empty-action"
                  title="新建空白页面：一个默认区块 + 标题块"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateBlank();
                  }}
                >
                  空白页面
                </button>
              )}
              {onCreateLanding && (
                <button
                  type="button"
                  className="canvas-empty-action"
                  title="新建宣传落地页骨架：头部 / 中部 / 底部三个区块"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateLanding();
                  }}
                >
                  宣传落地页骨架
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {!interactive && doc.boards.length === 0 && doc.freeItems.length === 0 && (
        <div className="canvas-empty-hint" aria-hidden="true">
          这张画布还没有内容
        </div>
      )}
    </div>
  );
}

/** 视口订阅（独立小 hook，避免整个组件因视口变化重渲染）。 */
function useStoreViewport(store: CanvasStore) {
  const vp = useMemo(() => store.getState().viewport, [store]);
  const [current, setCurrent] = useState(vp);
  useEffect(() => {
    return store.subscribe((state) => {
      setCurrent(state.viewport);
    });
  }, [store]);
  return current;
}

/** 「适合全部」：计算包围盒并设置视口。由工具条调用。 */
export function zoomToFit(
  scene: Scene,
  setViewport: (vp: Partial<{ x: number; y: number; zoom: number }>) => void,
  rect: { width: number; height: number },
): void {
  const bounds = sceneBounds(scene);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    setViewport({ x: 40, y: 40, zoom: 1 });
    return;
  }
  zoomToFitBounds(bounds, setViewport, rect);
}

/** 适合给定选区，空/无效包围盒保持当前视口。与适合全部共用边距与缩放上限。 */
export function zoomToFitBounds(
  bounds: SelectionBounds | null,
  setViewport: (vp: Partial<{ x: number; y: number; zoom: number }>) => void,
  rect: { width: number; height: number },
): void {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
  const zoom = clampZoom(
    Math.min((rect.width - 120) / bounds.width, (rect.height - 120) / bounds.height, 1),
  );
  setViewport({
    zoom,
    x: (rect.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (rect.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  });
}
