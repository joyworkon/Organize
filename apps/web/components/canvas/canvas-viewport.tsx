"use client";

/**
 * 无限画布视口（docs/idea-canvas-plan.md §6.2）。
 *
 * - 坐标换算 world = (client − viewportRect − pan) / zoom，不写死侧栏/页头偏移；
 * - Ctrl/Meta+滚轮围绕指针缩放（10%–400%），滚轮/触控板平移，空格或中键拖拽平移；
 * - 双击空白在指针世界坐标建版面；文本编辑期间不拦截空格/方向键。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { CanvasDoc } from "@/lib/canvas/model";
import { createBoardSkeleton } from "@/lib/canvas/commands";
import { sceneBounds, type Scene } from "@/lib/canvas/layout";
import { screenToWorld, worldToScreen as toScreen } from "@/lib/canvas/coords";
import type { ExplicitInsertPosition } from "@/lib/canvas/insert-target";
import { hitTestInsertPosition } from "./canvas-hit-test";
import type { CanvasStore } from "./canvas-store";
import { CanvasBoardView } from "./canvas-board";
import { CanvasFreeItemView } from "./canvas-free-item";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

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
  onCreateBlank,
  onCreateLanding,
  onReplaceImage,
  onInsertFiles,
}: CanvasViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const vp = useStoreViewport(store);
  /** 最近一次指针在视口内的世界坐标（粘贴落点用）。 */
  const lastPointerWorldRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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

  const onWheel = useCallback(
    (e: ReactWheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.002);
        zoomAt(factor, e.clientX, e.clientY);
      } else {
        // 触控板/滚轮平移
        e.preventDefault();
        const state = store.getState();
        store.getState().setViewport({ x: state.viewport.x - e.deltaX, y: state.viewport.y - e.deltaY });
      }
    },
    [store, zoomAt],
  );

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
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
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

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!interactive || !onInsertFiles) return;
      // 输入控件内粘贴交给控件本身（工作区 isTypingTarget 同规则）
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      const at = lastPointerWorldRef.current;
      const explicit = hitTestInsertPosition(doc, scene, at.x, at.y);
      onInsertFiles(files, explicit, at);
    },
    [interactive, onInsertFiles, doc, scene],
  );

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
      className={`canvas-viewport ${spaceHeld || panning ? "is-panning" : ""}`}
      data-testid="canvas-viewport"
      style={{
        backgroundSize: `${24 * vp.zoom}px ${24 * vp.zoom}px`,
        backgroundPosition: `${vp.x}px ${vp.y}px`,
      }}
      onWheel={onWheel}
      onPointerDown={(e) => {
        beginPan(e);
        onPointerDownBackground(e);
      }}
      onPointerMove={(e) => {
        // 记录指针世界坐标（粘贴落点）；命中测试交给拖入事件本身
        const at = pointerWorld(e.clientX, e.clientY);
        if (at) lastPointerWorldRef.current = at;
        onPanMove(e);
      }}
      onPointerUp={endPan}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPaste={onPaste}
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
              selectedBlockId={selection?.kind === "block" ? selection.blockId : null}
              editingBlockId={editingBlockId}
              onReplaceImage={onReplaceImage}
            />
          );
        })}
        {doc.freeItems.map((item) => {
          return (
            <CanvasFreeItemView
              key={item.id}
              item={item}
              store={store}
              zoom={vp.zoom}
              interactive={interactive}
              selected={selection?.kind === "free" && selection.itemId === item.id}
              editing={editingBlockId === item.id}
              userId={userId}
              assetUrls={assetUrls}
            />
          );
        })}
      </div>
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
  const zoom = clampZoom(
    Math.min((rect.width - 120) / bounds.width, (rect.height - 120) / bounds.height, 1),
  );
  setViewport({
    zoom,
    x: (rect.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (rect.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  });
}
