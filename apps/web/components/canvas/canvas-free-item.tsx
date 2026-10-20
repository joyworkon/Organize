"use client";

/**
 * 自由容器（docs/idea-canvas-plan.md §3.5）：绝对定位的文本/图片，
 * 独立于自动版面，拖动移动、调整宽度、层级可调；Enter 只换行不建块。
 * 高度由内容计算（文本测量 / 图片比例），不持久化。
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MIN_TEXT_CONTENT_HEIGHT, type CanvasFreeItem } from "@/lib/canvas/model";
import { deleteFreeItem, updateFreeItem, updateFreeItemBlock } from "@/lib/canvas/commands";
import {
  freeIdsFromSelection,
  nextFreeIdsOnClick,
  selectionFromFreeIds,
  snapGroupMove,
  type FreeGroupMember,
} from "@/lib/canvas/free-selection";
import { resolveTextStyle } from "@/lib/canvas/text-styles";
import {
  MIN_FREE_ITEM_WIDTH,
  snapFreeItem,
  type SnapGuide,
  type SnapRect,
} from "@/lib/canvas/snap";
import { applyMoveFreeItems } from "./free-item-actions";
import { applyCanvasTextStyle } from "./text-measurer";
import type { CanvasStore } from "./canvas-store";
import { displayKey } from "./canvas-block";
import { retryPendingAsset, uploadCanvasImage } from "@/lib/canvas/assets";
import { toast } from "@/hooks/use-toast";

/** 模块级拖动标记：工作区 Esc 需感知「拖动中」以免误清选区。 */
let freeDragActive = false;
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
  onGroupLive: (live: { dx: number; dy: number } | null) => void;
  /** 拖动中上报参考线；结束/取消传 null。 */
  onSnapGuides: (guides: SnapGuide[] | null) => void;
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
  onGroupLive,
  onSnapGuides,
}: CanvasFreeItemViewProps) {
  const dragRef = useRef<{
    mode: "move" | "resize";
    pointerId: number;
    el: HTMLElement;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    moved: boolean;
    /** 最近一次吸附修正后的提交值（endDrag 与 live 一致，松手不跳位）。 */
    last: { x: number; y: number; width: number };
    /** 按下时的整组成员；null 表示只拖自己。 */
    group: FreeGroupMember[] | null;
    lastGroup: { dx: number; dy: number } | null;
  } | null>(null);
  const [live, setLive] = useState<{ dx: number; dy: number; w: number } | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.el.hasPointerCapture(drag.pointerId)) drag.el.releasePointerCapture(drag.pointerId);
    dragRef.current = null;
    freeDragActive = false;
    setLive(null);
    onGroupLive(null);
    onSnapGuides(null);
  }, [onGroupLive, onSnapGuides]);

  // 拖动中 Esc：只取消本次拖动（不清选区——工作区按 isFreeItemDragging 让位）
  const escRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const detachEsc = useCallback(() => {
    if (escRef.current) {
      window.removeEventListener("keydown", escRef.current, true);
      escRef.current = null;
    }
  }, []);
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
    if (!editing || item.block.type !== "text") return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [editing, item.block.type]);

  const beginDrag = useCallback(
    (e: ReactPointerEvent, mode: "move" | "resize") => {
      if (!interactive || e.button === 2) return;
      e.stopPropagation();
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      dragRef.current = {
        mode,
        pointerId: e.pointerId,
        el,
        startX: e.clientX,
        startY: e.clientY,
        originX: item.x,
        originY: item.y,
        originWidth: item.width,
        moved: false,
        last: { x: item.x, y: item.y, width: item.width },
        group: mode === "move" ? getGroupMembers() : null,
        lastGroup: null,
      };
      freeDragActive = true;
      attachEsc();
    },
    [attachEsc, getGroupMembers, interactive, item.width, item.x, item.y],
  );

  const onDragMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
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
      if (!drag.moved) {
        setLive({
          dx: drag.mode === "move" ? dx : 0,
          dy: drag.mode === "move" ? dy : 0,
          w: drag.mode === "resize" ? Math.max(MIN_FREE_ITEM_WIDTH, drag.originWidth + dx) : item.width,
        });
        return;
      }
      const moving: SnapRect =
        drag.mode === "move"
          ? { x: drag.originX + dx, y: drag.originY + dy, width: item.width, height }
          : { x: drag.originX, y: drag.originY, width: Math.max(MIN_FREE_ITEM_WIDTH, drag.originWidth + dx), height };
      // 按住 ⌥ 临时关闭吸附
      const snapped = e.altKey
        ? { x: moving.x, y: moving.y, width: moving.width, guides: [] as SnapGuide[] }
        : snapFreeItem(moving, snapTargets, 6 / zoom, drag.mode);
      drag.last = { x: snapped.x, y: snapped.y, width: snapped.width };
      setLive({
        dx: snapped.x - drag.originX,
        dy: snapped.y - drag.originY,
        w: snapped.width,
      });
      onSnapGuides(snapped.guides.length > 0 ? snapped.guides : null);
    },
    [height, item.width, onGroupLive, onSnapGuides, snapTargets, snapTargetsFor, zoom],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
      freeDragActive = false;
      detachEsc();
      setLive(null);
      onSnapGuides(null);
      if (drag.group && drag.group.length > 1) {
        const delta = drag.lastGroup;
        onGroupLive(null);
        if (drag.moved && delta && (delta.dx !== 0 || delta.dy !== 0)) {
          applyMoveFreeItems(store, drag.group.map((member) => ({
            itemId: member.id,
            x: member.x + delta.dx,
            y: member.y + delta.dy,
          })));
        }
        return;
      }
      onGroupLive(null);
      if (!drag.moved) return;
      const { last } = drag;
      if (drag.mode === "move") {
        store.getState().apply("移动自由容器", (d) =>
          updateFreeItem(d, { itemId: item.id, x: last.x, y: last.y }),
        );
      } else {
        store.getState().apply("调整自由容器宽度", (d) =>
          updateFreeItem(d, { itemId: item.id, width: Math.max(MIN_FREE_ITEM_WIDTH, last.width) }),
        );
      }
    },
    [detachEsc, item.id, onGroupLive, onSnapGuides, store],
  );

  const x = item.x + (live?.dx ?? 0) + (groupLive?.dx ?? 0);
  const y = item.y + (live?.dy ?? 0) + (groupLive?.dy ?? 0);
  const width = live?.w ?? item.width;

  // 局部窄化：三元分支内 TS 无法凭 isText 收窄 item.block
  const block = item.block;
  const isText = block.type === "text";
  const textBlock = isText ? block : null;
  const imageBlock = block.type === "image" ? block : null;
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
      className={`canvas-free-item ${selected ? "is-selected" : ""} ${interactive ? "" : "is-static"}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px`, zIndex: item.zIndex,
        background: block.style?.background ? `var(--cv-bg-${block.style.background})` : undefined,
        borderRadius: block.style?.radius != null ? `${block.style.radius}px` : undefined }}
      data-free-item-id={item.id}
      role="button"
      tabIndex={interactive && !editing ? 0 : -1}
      aria-label={isText ? "自由文本内容框" : "自由图片内容框"}
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
      {selected && interactive && !grouped && (
        <span className="canvas-free-badge" aria-label="自由定位元素">
          自由定位
        </span>
      )}

      {textBlock ? (
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

      {selected && interactive && !grouped && (
        <>
          {/* 移动手柄（方向键微调由工作区统一处理：1px / ⇧10px） */}
          <div
            className="canvas-free-move"
            title="拖动移动"
            aria-label="拖动移动自由容器"
            role="button"
            tabIndex={0}
            onPointerDown={(e) => beginDrag(e, "move")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
          />
          {/* 宽度手柄 */}
          <div
            className="canvas-free-resize"
            title="拖动调整宽度"
            aria-label="拖动调整自由容器宽度"
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              store.getState().apply("调整自由容器宽度", (d) => updateFreeItem(d, { itemId: item.id, width: Math.max(MIN_FREE_ITEM_WIDTH, item.width + (e.key === "ArrowLeft" ? -10 : 10)) }));
            }}
            role="button"
            tabIndex={0}
            onPointerDown={(e) => beginDrag(e, "resize")}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
          />
          <div className="canvas-free-actions">
            <button
              type="button"
              className="canvas-free-action"
              title="上移一层"
              aria-label="自由容器上移一层"
              onClick={() =>
                store.getState().apply("上移自由容器", (d) =>
                  updateFreeItem(d, { itemId: item.id, zIndex: item.zIndex + 1 }),
                )
              }
            >
              ↑
            </button>
            <button
              type="button"
              className="canvas-free-action"
              title="下移一层"
              aria-label="自由容器下移一层"
              onClick={() =>
                store.getState().apply("下移自由容器", (d) =>
                  updateFreeItem(d, { itemId: item.id, zIndex: Math.max(0, item.zIndex - 1) }),
                )
              }
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
