"use client";

/**
 * 自由容器（docs/idea-canvas-plan.md §3.5）：绝对定位的文本/图片/形状，
 * 独立于自动版面，拖动移动、调整宽度、层级可调；Enter 只换行不建块。
 * 文本/图片高度由内容计算；形状独立保存高度，可调整宽高。
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CONNECTOR_SIDES } from "@/lib/canvas/connectors";
import { MIN_TEXT_CONTENT_HEIGHT, SHAPE_MIN_HEIGHT, SHAPE_MAX_HEIGHT, type CanvasFreeItem, type CanvasConnectorSide } from "@/lib/canvas/model";
import { BLOCK_CHROME } from "@/lib/canvas/layout";
import { deleteFreeItem, updateFreeItem, updateFreeItemBlock } from "@/lib/canvas/commands";
import {
  freeIdsFromSelection,
  nextFreeIdsOnClick,
  selectionFromFreeIds,
  snapGroupMove,
  type FreeGroupMember,
} from "@/lib/canvas/free-selection";
import { resizeFreeItem, type FreeResizeHandle } from "@/lib/canvas/free-resize";
import { CanvasFreeResizeHandles } from "./canvas-free-resize-handles";
import { resolveTextStyle } from "@/lib/canvas/text-styles";
import {
  snapFreeItem,
  type SnapGuide,
  type SnapRect,
} from "@/lib/canvas/snap";
import { applyArrangeAction, applyMoveFreeItems } from "./free-item-actions";
import { applyCanvasTextStyle } from "./text-measurer";
import type { CanvasStore } from "./canvas-store";
import { displayKey } from "./canvas-block";
import { retryPendingAsset, uploadCanvasImage } from "@/lib/canvas/assets";
import { toast } from "@/hooks/use-toast";

/** 模块级拖动标记：工作区 Esc 需感知「拖动中」以免误清选区。 */
let freeDragActive = false;
export function setFreeItemDragging(active: boolean): void { freeDragActive = active; }
export function isFreeItemDragging(): boolean {
  return freeDragActive;
}

export interface CanvasFreeItemViewProps {
  item: CanvasFreeItem;
  height: number;
  store: CanvasStore;
  zoom: number;
  interactive: boolean;
  selected: boolean;
  editing: boolean;
  userId: string;
  assetUrls: Record<string, string>;
  /** 吸附候选（其他自由元素 + 全部页面，世界坐标，已排除自身）。 */
  snapTargets: SnapRect[];
  /** 成组拖动时按排除 id 取吸附目标（排除组内全部）。 */
  snapTargetsFor: (excludeIds: readonly string[]) => SnapRect[];
  /** 当前选区里可一起移动的自由元素；不足两个时返回 null。 */
  getGroupMembers: () => FreeGroupMember[] | null;
  /** 多选：隐藏单件徽标和手柄，由视口画整组外接框。 */
  grouped: boolean;
  /** 整组拖动的实时位移（世界坐标）。 */
  groupLive: { dx: number; dy: number } | null;
  groupResizeLive?: FreeGroupMember | null;
  heightForWidth?: (width: number) => number;
  onGroupLive: (live: { dx: number; dy: number } | null) => void;
  /** 拖动中上报参考线；结束/取消传 null。 */
  onSnapGuides: (guides: SnapGuide[] | null) => void;
  onLiveGeometry?: (id: string, rect: SnapRect | null) => void;
  onConnect?: (side?: CanvasConnectorSide) => void;
}

export const CanvasFreeItemView = memo(function CanvasFreeItemView({
  item,
  height,
  store,
  zoom,
  interactive,
  selected,
  editing,
  userId,
  assetUrls,
  snapTargets,
  snapTargetsFor,
  getGroupMembers,
  grouped,
  groupLive,
  groupResizeLive,
  heightForWidth,
  onGroupLive,
  onSnapGuides,
  onLiveGeometry,
  onConnect,
}: CanvasFreeItemViewProps) {
  const dragRef = useRef<{
    mode: "move" | "resize";
    handle: FreeResizeHandle;
    originHeight: number;
    pointerId: number;
    el: HTMLElement;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    moved: boolean;
    /** 最近一次吸附修正后的提交值（endDrag 与 live 一致，松手不跳位）。 */
    last: { x: number; y: number; width: number; height: number };
    /** 按下时的整组成员；null 表示只拖自己。 */
    group: FreeGroupMember[] | null;
    lastGroup: { dx: number; dy: number } | null;
  } | null>(null);
  const [live, setLive] = useState<{ dx: number; dy: number; w: number; h?: number; handle?: FreeResizeHandle } | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const escRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const detachEsc = useCallback(() => {
    if (escRef.current) {
      window.removeEventListener("keydown", escRef.current, true);
      escRef.current = null;
    }
  }, []);

  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    detachEsc();
    dragRef.current = null;
    if (drag.el.hasPointerCapture(drag.pointerId)) drag.el.releasePointerCapture(drag.pointerId);
    freeDragActive = false;
    setLive(null);
    onGroupLive(null);
    onSnapGuides(null);
  }, [detachEsc, onGroupLive, onSnapGuides]);

  // 拖动中 Esc：只取消本次拖动（不清选区——工作区按 isFreeItemDragging 让位）
  const attachEsc = useCallback(() => {
    detachEsc();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelDrag();
      detachEsc();
    };
    escRef.current = onKey;
    window.addEventListener("keydown", onKey, true);
  }, [cancelDrag, detachEsc]);

  // 卸载兜底：不残留拖动标记、监听与参考线
  useEffect(() => {
    return () => {
      detachEsc();
      if (dragRef.current) {
        dragRef.current = null;
        freeDragActive = false;
        onGroupLive(null);
        onSnapGuides(null);
      }
    };
  }, [detachEsc, onGroupLive, onSnapGuides]);

  useEffect(() => {
    if (!interactive || store.getState().readOnly) cancelDrag();
  }, [cancelDrag, interactive, store]);

  useEffect(() => {
    if (!editing || item.block.type !== "text") return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [editing, item.block.type]);

  const beginDrag = useCallback(
    (e: ReactPointerEvent, mode: "move" | "resize", handle: FreeResizeHandle = "e") => {
      if (!interactive || store.getState().readOnly || dragRef.current || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      // preventDefault cancels native focus; move it out of the property form so ⌘Z undoes this gesture.
      el.focus({ preventScroll: true });
      dragRef.current = {
        mode,
        handle,
        originHeight: height,
        pointerId: e.pointerId,
        el,
        startX: e.clientX,
        startY: e.clientY,
        originX: item.x,
        originY: item.y,
        originWidth: item.width,
        moved: false,
        last: { x: item.x, y: item.y, width: item.width, height },
        group: mode === "move" ? getGroupMembers() : null,
        lastGroup: null,
      };
      freeDragActive = true;
      attachEsc();
    },
    [attachEsc, getGroupMembers, height, interactive, item.width, item.x, item.y, store],
  );

  const onDragMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.stopPropagation();
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      if (drag.group && drag.group.length > 1) {
        if (!drag.moved) {
          onGroupLive({ dx, dy });
          return;
        }
        const snapped = e.altKey
          ? { dx, dy, guides: [] as SnapGuide[] }
          : snapGroupMove(drag.group, dx, dy, snapTargetsFor(drag.group.map((member) => member.id)), 6 / zoom, true);
        drag.lastGroup = { dx: snapped.dx, dy: snapped.dy };
        onGroupLive({ dx: snapped.dx, dy: snapped.dy });
        onSnapGuides(snapped.guides.length > 0 ? snapped.guides : null);
        return;
      }
      if (!drag.moved) return;
      const origin = { x: drag.originX, y: drag.originY, width: drag.originWidth, height: drag.originHeight };
      const snapped = drag.mode === "resize"
        ? resizeFreeItem(origin, drag.handle, dx, dy, {
            center: e.shiftKey, snapEnabled: !e.altKey, targets: snapTargets, threshold: 6 / zoom, heightForWidth,
            independentHeight: item.block.type === "shape", minHeight: SHAPE_MIN_HEIGHT + BLOCK_CHROME, maxHeight: SHAPE_MAX_HEIGHT + BLOCK_CHROME,
          })
        : e.altKey
          ? { ...origin, x: origin.x + dx, y: origin.y + dy, guides: [] as SnapGuide[] }
          : snapFreeItem({ ...origin, x: origin.x + dx, y: origin.y + dy }, snapTargets, 6 / zoom, "move");
      const nextHeight = "height" in snapped && typeof snapped.height === "number" ? snapped.height : drag.originHeight;
      drag.last = { x: snapped.x, y: snapped.y, width: snapped.width, height: nextHeight };
      setLive({
        dx: snapped.x - drag.originX, dy: snapped.y - drag.originY, w: snapped.width,
        h: nextHeight,
        handle: drag.mode === "resize" ? drag.handle : undefined,
      });
      onSnapGuides(snapped.guides.length > 0 ? snapped.guides : null);
    },
    [heightForWidth, item.block.type, onGroupLive, onSnapGuides, snapTargets, snapTargetsFor, zoom],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.stopPropagation();
      dragRef.current = null;
      if (drag.el.hasPointerCapture(e.pointerId)) drag.el.releasePointerCapture(e.pointerId);
      freeDragActive = false;
      detachEsc();
      setLive(null);
      onSnapGuides(null);
      if (drag.group && drag.group.length > 1) {
        const delta = drag.lastGroup;
        onGroupLive(null);
        if (interactive && !store.getState().readOnly && drag.moved && delta && (delta.dx !== 0 || delta.dy !== 0)) {
          applyMoveFreeItems(store, drag.group.map((member) => ({
            itemId: member.id,
            x: member.x + delta.dx,
            y: member.y + delta.dy,
          })));
        }
        return;
      }
      onGroupLive(null);
      if (!interactive || store.getState().readOnly || !drag.moved) return;
      const { last } = drag;
      if (drag.mode === "move") {
        store.getState().apply("移动自由容器", (d) =>
          updateFreeItem(d, { itemId: item.id, x: last.x, y: last.y }),
        );
      } else {
        store.getState().apply("调整自由容器尺寸", (d) =>
          updateFreeItem(d, { itemId: item.id, ...last }),
        );
      }
    },
    [detachEsc, interactive, item.id, onGroupLive, onSnapGuides, store],
  );

  const x = (groupResizeLive?.x ?? item.x) + (live?.dx ?? 0) + (groupLive?.dx ?? 0);
  const y = (groupResizeLive?.y ?? item.y) + (live?.dy ?? 0) + (groupLive?.dy ?? 0);
  const width = live?.w ?? groupResizeLive?.width ?? item.width;
  const displayHeight = live?.h ?? (groupResizeLive ? item.block.type === "shape" ? groupResizeLive.height : heightForWidth?.(width) ?? height : height);
  useEffect(() => {
    onLiveGeometry?.(item.id, live ? { x, y, width, height: displayHeight } : null);
  }, [item.id, live, x, y, width, displayHeight, onLiveGeometry]);
  useEffect(() => () => onLiveGeometry?.(item.id, null), [item.id, onLiveGeometry]);
  const canResize = interactive && !store.getState().readOnly;

  // 局部窄化：三元分支内 TS 无法凭 isText 收窄 item.block
  const block = item.block;
  const isText = block.type === "text";
  const textBlock = isText ? block : null;
  const imageBlock = block.type === "image" ? block : null;
  const shapeBlock = block.type === "shape" ? block : null;
  const textStyle = textBlock ? resolveTextStyle(textBlock) : null;
  const asset = imageBlock?.asset ?? null;
  const resolvedUrl =
    asset && imageBlock ? assetUrls[displayKey(item.id, asset)] ?? (asset.url || null) : null;

  const pickFile = () => inputRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const outcome = await uploadCanvasImage(file, userId);
      store.getState().apply("插入图片", (d) =>
        updateFreeItemBlock(d, { itemId: item.id, asset: outcome.asset }),
      );
      if (outcome.previewUrl) {
        store.getState().setAssetUrl(displayKey(item.id, outcome.asset), outcome.previewUrl);
      }
    } catch (error) {
      toast({
        title: "图片上传失败",
        description: error instanceof Error ? error.message : "请重试",
        variant: "destructive",
      });
    }
  };

  // 同块原位重试：pending/failed 资产从本机取回重新上传，不新增容器
  const handleRetry = async () => {
    const pending = asset;
    if (!pending?.localKey || pending.uploadStatus === "saved") {
      pickFile();
      return;
    }
    try {
      const outcome = await retryPendingAsset(pending, pending.localKey, userId);
      if (!outcome) {
        toast({
          title: "图片重试失败",
          description: "本机原图缺失或已上传，请重新选择图片",
          variant: "destructive",
        });
        return;
      }
      store.getState().apply("重试上传图片", (d) =>
        updateFreeItemBlock(d, { itemId: item.id, asset: outcome.asset }),
      );
      if (outcome.previewUrl) {
        store.getState().setAssetUrl(displayKey(item.id, outcome.asset), outcome.previewUrl);
      }
    } catch (error) {
      toast({
        title: "图片重试失败",
        description: error instanceof Error ? error.message : "请重试",
        variant: "destructive",
      });
    }
  };

  const canRetry = !!asset?.localKey && asset.uploadStatus !== "saved";

  return (
    <div
      className={`canvas-free-item ${shapeBlock ? "is-shape" : ""} ${shapeBlock?.kind === "ellipse" ? "is-ellipse" : ""} ${selected ? "is-selected" : ""} ${interactive ? "" : "is-static"}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${displayHeight}px`, zIndex: item.zIndex,
        background: block.style?.background ? `var(--cv-bg-${block.style.background})` : undefined,
        borderRadius: shapeBlock?.kind === "ellipse" ? "50%" : block.style?.radius != null ? `${block.style.radius}px` : undefined }}
      data-free-item-id={item.id}
      data-shape-kind={shapeBlock?.kind}
      role="button"
      tabIndex={(interactive || !!onConnect) && !editing ? 0 : -1}
      aria-label={shapeBlock ? `自由${shapeBlock.kind === "rect" ? "矩形" : "椭圆"}` : isText ? "自由文本内容框" : "自由图片内容框"}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || !interactive || editing || e.key !== "Enter" || !isText) return;
        e.preventDefault();
        store.getState().startEdit(item.id);
      }}
      onPointerDown={
        interactive
          ? (e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              if (editing) {
                store.getState().select({ kind: "free", itemId: item.id });
                return;
              }
              const current = freeIdsFromSelection(store.getState().selection);
              store.getState().select(selectionFromFreeIds(nextFreeIdsOnClick(current, item.id, e.shiftKey)));
              if (e.shiftKey) {
                e.preventDefault();
                return;
              }
              if (!(e.target as HTMLElement).closest("button, input, textarea")) beginDrag(e, "move");
            }
          : undefined
      }
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={cancelDrag}
      onDoubleClick={
        interactive && isText && !editing ? () => store.getState().startEdit(item.id) : undefined
      }
    >
      {!editing && !grouped && onConnect && CONNECTOR_SIDES.map((side) => (
        <button key={side} type="button" className={`canvas-connector-port canvas-connector-port-${side}`}
          data-connector-port={side} aria-label={`从${({ top: "上", right: "右", bottom: "下", left: "左" })[side]}边连接`}
          style={{ transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            left: side === "left" ? -28 / zoom : side === "right" ? `calc(100% + ${28 / zoom}px)` : undefined,
            top: shapeBlock ? side === "top" ? -28 / zoom : side === "bottom" ? `calc(100% + ${28 / zoom}px)` : undefined : undefined }}
          onClick={(e) => { e.stopPropagation(); if (e.detail === 0) onConnect(side); }} />
      ))}
      {selected && !grouped && onConnect && (
        <button type="button" className="canvas-connect-start" aria-label="连接到另一个元素"
          style={{ transform: `scale(${1 / zoom})`, transformOrigin: "top left" }}
          data-connect-start="true" onClick={(e) => { e.stopPropagation(); onConnect(); }}>连接</button>
      )}
      {selected && canResize && !grouped && (
        <span className="canvas-free-badge" aria-label="自由定位元素">
          自由定位
        </span>
      )}

      {shapeBlock ? null : textBlock ? (
        editing && interactive ? (
          <textarea
            ref={(el) => {
              textareaRef.current = el;
              if (el && textStyle) applyCanvasTextStyle(el, textStyle);
            }}
            className="canvas-text-content canvas-textarea"
            style={{ height: "100%", resize: "none" }}
            value={textBlock.text}
            onChange={(e) =>
              store.getState().apply(
                "输入",
                (d) => updateFreeItemBlock(d, { itemId: item.id, text: e.target.value }),
                { coalesceKey: `free-text:${item.id}:${store.getState().compositionSeq}` },
              )
            }
            onBlur={() => store.getState().stopEdit(item.id)}
            onCompositionEnd={() => store.getState().bumpComposition()}
            aria-label="自由文本"
            spellCheck={false}
          />
        ) : (
          <div
            className="canvas-text-content"
            ref={(el) => {
              if (el && textStyle) applyCanvasTextStyle(el, textStyle);
            }}
            style={{ minHeight: MIN_TEXT_CONTENT_HEIGHT }}
          >
            {textBlock.text + (textBlock.text === "" || textBlock.text.endsWith("\n") ? "\u200b" : "")}
          </div>
        )
      ) : resolvedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedUrl ?? undefined}
          alt={asset?.name || "自由图片"}
          className="canvas-image-img"
          style={{ objectFit: imageBlock?.fit ?? "contain" }}
          draggable={false}
        />
      ) : canRetry ? (
        <div className="canvas-image-retry" role="group" aria-label="图片待上传">
          <button
            type="button"
            className="canvas-image-retry-btn"
            onClick={interactive ? () => void handleRetry() : undefined}
            disabled={!interactive}
            aria-label="重试上传"
          >
            重试上传
          </button>
          <button
            type="button"
            className="canvas-image-retry-btn"
            onClick={interactive ? pickFile : undefined}
            disabled={!interactive}
            aria-label="重新选择图片"
          >
            重新选择
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="canvas-image-placeholder"
          onClick={interactive ? pickFile : undefined}
          disabled={!interactive}
          aria-label="选择图片"
        >
          {asset ? "图片加载失败，点击重选" : "选择图片"}
        </button>
      )}

      {selected && canResize && !grouped && (
        <>
          {/* 移动手柄（方向键微调由工作区统一处理：1px / ⇧10px） */}
          <div
            className="canvas-free-move"
            style={{ top: onConnect ? -16 - (shapeBlock ? 52 : 24) / zoom : undefined }}
            title="拖动移动"
            aria-label="拖动移动自由容器"
            role="button"
            tabIndex={0}
            onPointerDown={(e) => beginDrag(e, "move")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
          />
          <CanvasFreeResizeHandles
            zoom={zoom}
            shape={!!shapeBlock}
            active={live?.handle}
            size={item.block.type !== "text" ? `${Math.round(width)} × ${Math.round(displayHeight)}` : `${Math.round(width)} px`}
            onBegin={(e, handle) => beginDrag(e, "resize", handle)}
            onMove={onDragMove}
            onEnd={endDrag}
            onCancel={() => { cancelDrag(); detachEsc(); }}
            onKeyDown={(e, handle) => {
              const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
              const vertical = !!shapeBlock && (e.key === "ArrowUp" || e.key === "ArrowDown");
              if (!horizontal && !vertical) return;
              e.preventDefault();
              e.stopPropagation();
              if (!canResize || store.getState().readOnly) return;
              const next = resizeFreeItem({ x: item.x, y: item.y, width: item.width, height }, handle,
                horizontal ? e.key === "ArrowLeft" ? -10 : 10 : 0, vertical ? e.key === "ArrowUp" ? -10 : 10 : 0,
                { center: e.shiftKey, snapEnabled: false, heightForWidth, independentHeight: !!shapeBlock,
                  minHeight: SHAPE_MIN_HEIGHT + BLOCK_CHROME, maxHeight: SHAPE_MAX_HEIGHT + BLOCK_CHROME });
              store.getState().apply("调整自由容器尺寸", (d) => updateFreeItem(d, { itemId: item.id, x: next.x, y: next.y, width: next.width, height: next.height }));
            }}
          />
          <div className="canvas-free-actions">
            <button
              type="button"
              className="canvas-free-action"
              title="上移一层"
              aria-label="自由容器上移一层"
              onClick={() => applyArrangeAction(store, "layer-forward", [], [item.id])}
            >
              ↑
            </button>
            <button
              type="button"
              className="canvas-free-action"
              title="下移一层"
              aria-label="自由容器下移一层"
              onClick={() => applyArrangeAction(store, "layer-backward", [], [item.id])}
            >
              ↓
            </button>
            <button
              type="button"
              className="canvas-free-action"
              title="删除自由容器"
              aria-label="删除自由容器"
              onClick={() => store.getState().apply("删除自由容器", (d) => deleteFreeItem(d, { itemId: item.id }))}
            >
              ×
            </button>
          </div>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
});
