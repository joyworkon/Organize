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
import { resolveTextStyle } from "@/lib/canvas/text-styles";
import { applyCanvasTextStyle } from "./text-measurer";
import type { CanvasStore } from "./canvas-store";
import { displayKey } from "./canvas-block";
import { uploadCanvasImage } from "@/lib/canvas/assets";
import { toast } from "@/hooks/use-toast";

export interface CanvasFreeItemViewProps {
  item: CanvasFreeItem;
  store: CanvasStore;
  zoom: number;
  interactive: boolean;
  selected: boolean;
  editing: boolean;
  userId: string;
  assetUrls: Record<string, string>;
}

export const CanvasFreeItemView = memo(function CanvasFreeItemView({
  item,
  store,
  zoom,
  interactive,
  selected,
  editing,
  userId,
  assetUrls,
}: CanvasFreeItemViewProps) {
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    moved: boolean;
  } | null>(null);
  const [live, setLive] = useState<{ dx: number; dy: number; w: number } | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing || item.block.type !== "text") return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [editing, item.block.type]);

  const beginDrag = useCallback(
    (e: ReactPointerEvent, mode: "move" | "resize") => {
      if (!interactive) return;
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        originX: item.x,
        originY: item.y,
        originWidth: item.width,
        moved: false,
      };
    },
    [interactive, item.width, item.x, item.y],
  );

  const onDragMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      setLive({
        dx: drag.mode === "move" ? dx : 0,
        dy: drag.mode === "move" ? dy : 0,
        w: drag.mode === "resize" ? Math.max(80, drag.originWidth + dx) : item.width,
      });
    },
    [item.width, zoom],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      dragRef.current = null;
      setLive(null);
      if (!drag.moved) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      if (drag.mode === "move") {
        store.getState().apply("移动自由容器", (d) =>
          updateFreeItem(d, { itemId: item.id, x: drag.originX + dx, y: drag.originY + dy }),
        );
      } else {
        store.getState().apply("调整自由容器宽度", (d) =>
          updateFreeItem(d, { itemId: item.id, width: Math.max(80, drag.originWidth + dx) }),
        );
      }
    },
    [item.id, store, zoom],
  );

  const x = item.x + (live?.dx ?? 0);
  const y = item.y + (live?.dy ?? 0);
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

  return (
    <div
      className={`canvas-free-item ${selected ? "is-selected" : ""} ${interactive ? "" : "is-static"}`}
      style={{ left: `${x}px`, top: `${y}px`, width: `${width}px`, zIndex: item.zIndex }}
      data-free-item-id={item.id}
      onPointerDown={
        interactive
          ? () => store.getState().select({ kind: "free", itemId: item.id })
          : undefined
      }
      onDoubleClick={
        interactive && isText && !editing ? () => store.getState().startEdit(item.id) : undefined
      }
    >
      {selected && interactive && (
        <span className="canvas-free-badge" aria-label="自由定位元素">
          自由定位
        </span>
      )}

      {textBlock ? (
        editing && interactive ? (
          <textarea
            ref={textareaRef}
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
            onBlur={() => store.getState().stopEdit()}
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
            {textBlock.text}
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

      {selected && interactive && (
        <>
          {/* 移动手柄 */}
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
