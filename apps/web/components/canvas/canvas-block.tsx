"use client";

/**
 * 画布模块渲染：文本块（受控 textarea 编辑 + 非编辑渲染）与图片块
 * （contain/cover，占位、上传与重试）。结构交互（Enter 通栏、空块删除）
 * 在此层拦截键盘事件，命令仍走纯函数（规格 §3.1/§3.2/§4.2）。
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Image as ImageIcon, Loader2 } from "@/components/icons";
import {
  BLOCK_PADDING,
  type CanvasImageBlock,
  type CanvasTextBlock,
} from "@/lib/canvas/model";
import {
  deleteBlock,
  setImageAsset,
  splitTextToSection,
  updateTextBlock,
} from "@/lib/canvas/commands";
import { resolveTextStyle } from "@/lib/canvas/text-styles";
import { applyCanvasTextStyle } from "./text-measurer";
import type { CanvasStore } from "./canvas-store";
import { MAX_CANVAS_IMAGE_BYTES, isAllowedImageType, retryPendingAsset, uploadCanvasImage } from "@/lib/canvas/assets";
import { toast } from "@/hooks/use-toast";

export interface CanvasBlockViewProps {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 文本块编辑态（图片块无编辑概念）。 */
  editing?: boolean;
  selected: boolean;
  /** store 实例（每文档一个，避免 context 开销）。 */
  store: CanvasStore;
  /** 资产可渲染地址（已解析对象 URL / 持久 URL）。 */
  resolvedUrl?: string | null;
  /** 编辑结束（失焦）回调——智能比例重算触发点。 */
  onEditEnd?: (blockId: string) => void;
  /** 局部加号等悬停控件由父层作为 children 注入。 */
  children?: React.ReactNode;
  interactive: boolean;
  onFilePick?: (file: File) => void;
}

function boxStyle(
  x: number,
  y: number,
  width: number,
  height: number,
  style?: { background?: string | null; radius?: number | null },
): CSSProperties {
  return {
    position: "absolute",
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`,
    padding: `${BLOCK_PADDING}px`,
    boxSizing: "border-box",
    background: style?.background ? `var(--cv-bg-${style.background})` : undefined,
    borderRadius: style?.radius != null ? `${style.radius}px` : "var(--radius-lg)",
  };
}

export const CanvasTextBlockView = memo(function CanvasTextBlockView({
  block,
  x,
  y,
  width,
  height,
  editing,
  selected,
  store,
  structuralEnter,
  interactive,
  children,
  onEditEnd,
}: CanvasBlockViewProps & {
  block: CanvasTextBlock;
  structuralEnter: boolean;
}) {
  const text = block.text;
  const style = resolveTextStyle(block);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const focusState = store.getState().focus;
    if (focusState?.kind === "block" && focusState.blockId === block.id) {
      const len = text.length;
      const pos = focusState.caret === "start" ? 0 : len;
      el.setSelectionRange(pos, pos);
      store.getState().clearFocus();
    }
    // text.length 变化时不重复定位光标（用户正在输入）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, block.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const composing = e.nativeEvent.isComposing || e.keyCode === 229;
      if (e.key === "Enter" && !e.shiftKey && structuralEnter) {
        // 中文输入法候选确认不建块（规格 §3.2）
        if (composing) return;
        e.preventDefault();
        const start = ta.selectionStart ?? text.length;
        const end = ta.selectionEnd ?? start;
        store.getState().apply("新增通栏", (doc) =>
          splitTextToSection(doc, { blockId: block.id, selectionStart: start, selectionEnd: end }),
        );
        return;
      }
      if (e.key === "Backspace" && text === "" && !composing) {
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? 0;
        if (start === 0 && end === 0) {
          e.preventDefault();
          store.getState().apply("删除空块", (doc) => deleteBlock(doc, { blockId: block.id }));
        }
      }
    },
    [block.id, structuralEnter, store, text],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      store.getState().apply(
        "输入",
        (doc) => updateTextBlock(doc, { blockId: block.id, text: e.target.value }),
        { coalesceKey: `text:${block.id}:${store.getState().compositionSeq}` },
      );
    },
    [block.id, store],
  );

  const contentStyle: CSSProperties = {
    width: "100%",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    position: "relative",
  };

  return (
    <div
      className={`canvas-block canvas-block-text group ${selected ? "is-selected" : ""} ${editing ? "is-editing" : ""}`}
      style={boxStyle(x, y, width, height, block.style)}
      data-block-id={block.id}
      data-block-type="text"
      role="button"
      tabIndex={interactive && !editing ? 0 : -1}
      aria-label={(block.role === "title" ? "标题：" : "正文：") + (text || "空")}
      onPointerDown={
        interactive && !editing
          ? () => store.getState().select({ kind: "block", blockId: block.id })
          : undefined
      }
      onDoubleClick={interactive && !editing ? () => store.getState().startEdit(block.id) : undefined}
      onKeyDown={
        interactive && !editing
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                store.getState().startEdit(block.id);
              }
            }
          : undefined
      }
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="canvas-text-content canvas-textarea"
          style={{ ...contentStyle, height: "100%", resize: "none" }}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            store.getState().stopEdit();
            onEditEnd?.(block.id);
          }}
          onCompositionEnd={() => store.getState().bumpComposition()}
          aria-label={block.role === "title" ? "标题模块" : "正文模块"}
          spellCheck={false}
        />
      ) : (
        <div
          className="canvas-text-content"
          style={contentStyle}
          ref={(el) => {
            if (el) applyCanvasTextStyle(el, style);
          }}
        >
          {text}
        </div>
      )}
      {!editing && text === "" && (
        <span className="canvas-placeholder" aria-hidden="true">
          {block.role === "title" ? "输入标题…" : "输入正文…"}
        </span>
      )}
      {children}
    </div>
  );
});

export function displayKey(blockId: string, asset: { url: string; localKey?: string }): string {
  if (asset.url) return asset.url;
  return `${blockId}|${asset.localKey ?? ""}`;
}

export const CanvasImageBlockView = memo(function CanvasImageBlockView({
  block,
  x,
  y,
  width,
  height,
  selected,
  store,
  resolvedUrl,
  interactive,
  children,
  userId,
}: CanvasBlockViewProps & { block: CanvasImageBlock; userId: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const asset = block.asset;

  const pickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!isAllowedImageType(file.type)) {
        toast({ title: "不支持的图片格式", description: "支持 JPEG / PNG / GIF / WebP / SVG", variant: "destructive" });
        return;
      }
      if (file.size > MAX_CANVAS_IMAGE_BYTES) {
        toast({ title: "图片不能超过 5MB", variant: "destructive" });
        return;
      }
      setUploading(true);
      try {
        const outcome = await uploadCanvasImage(file, userId);
        store.getState().apply("插入图片", (doc) => setImageAsset(doc, { blockId: block.id, asset: outcome.asset }));
        if (outcome.previewUrl) {
          store.getState().setAssetUrl(displayKey(block.id, outcome.asset), outcome.previewUrl);
        }
        // 图片插入后重算一文一图智能比例（触发点，规格 §4.2）
        store.getState().requestSmartRecompute();
      } catch (error) {
        toast({
          title: "图片上传失败",
          description: error instanceof Error ? error.message : "请重试",
          variant: "destructive",
        });
      } finally {
        setUploading(false);
      }
    },
    [block.id, store, userId],
  );

  const handleRetry = useCallback(async () => {
    const pending = block.asset;
    if (!pending?.localKey) {
      pickFile();
      return;
    }
    setUploading(true);
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
      // 同块原位重试：更新同一块的 asset，不新增块
      store.getState().apply("重试上传图片", (doc) => setImageAsset(doc, { blockId: block.id, asset: outcome.asset }));
      if (outcome.previewUrl) {
        store.getState().setAssetUrl(displayKey(block.id, outcome.asset), outcome.previewUrl);
      }
      store.getState().requestSmartRecompute();
    } catch (error) {
      toast({
        title: "图片重试失败",
        description: error instanceof Error ? error.message : "请重试",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }, [block.asset, block.id, pickFile, store, userId]);

  const showPlaceholder = !resolvedUrl;
  const canRetry = !!asset?.localKey && asset.uploadStatus !== "saved";
  return (
    <div
      className={`canvas-block canvas-block-image group ${selected ? "is-selected" : ""}`}
      style={boxStyle(x, y, width, height, block.style)}
      data-block-id={block.id}
      data-block-type="image"
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-label={asset ? `图片：${asset.name || "未命名"}` : "空图片模块"}
      onPointerDown={
        interactive ? () => store.getState().select({ kind: "block", blockId: block.id }) : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                pickFile();
              }
            }
          : undefined
      }
    >
      {showPlaceholder ? (
        canRetry ? (
          <div className="canvas-image-retry" role="group" aria-label="图片待上传">
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
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
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="canvas-image-placeholder"
            onClick={interactive ? pickFile : undefined}
            disabled={!interactive || uploading}
            aria-label="选择图片"
            title={asset ? "图片加载失败，点击重选" : "选择图片"}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
            <span className="text-xs">
              {uploading ? "上传中…" : asset ? "图片加载失败，点击重选" : "选择图片"}
            </span>
          </button>
        )
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedUrl ?? undefined}
          alt={asset?.name || "画布图片"}
          className="canvas-image-img"
          style={{ objectFit: block.fit }}
          draggable={false}
        />
      )}
      {asset?.uploadStatus === "pending" && resolvedUrl && (
        <button
          type="button"
          className="canvas-image-pending-badge"
          title="图片仅保存在本机，尚未上传，点击重试"
          onClick={interactive && canRetry ? () => void handleRetry() : undefined}
          disabled={!interactive || !canRetry}
        >
          待上传
        </button>
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
      {children}
    </div>
  );
});
