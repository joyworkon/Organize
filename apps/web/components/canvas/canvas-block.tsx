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
  type CSSProperties,
} from "react";
import { Image as ImageIcon, Loader2 } from "@/components/icons";
import {
  BLOCK_PADDING,
  isSafeButtonHref,
  type CanvasButtonBlock,
  type CanvasDividerBlock,
  type CanvasImageBlock,
  type CanvasMaterialCardBlock,
  type CanvasSourceRef,
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
import { isUploadingAsset } from "@/lib/canvas/image-insert";
import { MAX_CANVAS_IMAGE_BYTES, isAllowedImageType, retryPendingAsset } from "@/lib/canvas/assets";
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
      data-text-role={block.role}
      role="button"
      tabIndex={interactive && !editing ? 0 : -1}
      aria-label={
        (block.role === "title" ? "标题：" : block.role === "list" ? "列表：" : "正文：") +
        (text || "空")
      }
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
          aria-label={block.role === "title" ? "标题模块" : block.role === "list" ? "列表模块" : "正文模块"}
          spellCheck={false}
        />
      ) : (
        <div
          className={`canvas-text-content ${block.role === "list" ? "is-list" : ""}`}
          style={contentStyle}
          ref={(el) => {
            if (el) applyCanvasTextStyle(el, style);
          }}
        >
          {block.role === "list" ? renderListLines(text) : text}
        </div>
      )}
      {!editing && text === "" && (
        <span className="canvas-placeholder" aria-hidden="true">
          {block.role === "title" ? "输入标题…" : block.role === "list" ? "输入列表项，每行一条…" : "输入正文…"}
        </span>
      )}
      {children}
    </div>
  );
});

/** 列表角色：逐行渲染，行首加项目符号（编辑态 textarea 为原文，符号仅展示层）。 */
function renderListLines(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => (
    <div className="canvas-list-line" key={i}>
      {line || " "}
    </div>
  ));
}

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
  onReplace,
}: CanvasBlockViewProps & {
  block: CanvasImageBlock;
  userId: string;
  /** 替换图片（B2）：走统一上传入口；成功后原地更新，失败保留旧图。 */
  onReplace?: (blockId: string, file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
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
      if (onReplace) {
        onReplace(block.id, file);
        return;
      }
    },
    [block.id, onReplace],
  );

  const handleRetry = useCallback(async () => {
    const pending = block.asset;
    if (!pending?.localKey) {
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
    }
  }, [block.asset, block.id, pickFile, store, userId]);

  const uploading = isUploadingAsset(asset);
  const showPlaceholder = !resolvedUrl && !uploading;
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
      {uploading ? (
        <div className="canvas-image-uploading" role="status" aria-label="图片上传中">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-xs">上传中…</span>
        </div>
      ) : showPlaceholder ? (
        canRetry ? (
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
            title={asset ? "图片加载失败，点击重选" : "选择图片"}
          >
            <ImageIcon className="h-5 w-5" />
            <span className="text-xs">{asset ? "图片加载失败，点击重选" : "选择图片"}</span>
          </button>
        )
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedUrl ?? undefined}
          alt={block.alt || asset?.name || "画布图片"}
          className="canvas-image-img"
          style={{ objectFit: block.fit }}
          draggable={false}
        />
      )}
      {asset?.uploadStatus === "pending" && asset.localKey && resolvedUrl && (
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

/** 分隔线块（B2）：token 色细线；属性栏只有对齐与删除。 */
export const CanvasDividerBlockView = memo(function CanvasDividerBlockView({
  block,
  x,
  y,
  width,
  height,
  selected,
  store,
  interactive,
  children,
}: CanvasBlockViewProps & { block: CanvasDividerBlock }) {
  const align = block.style?.align ?? "left";
  return (
    <div
      className={`canvas-block canvas-block-divider group ${selected ? "is-selected" : ""}`}
      style={boxStyle(x, y, width, height, undefined)}
      data-block-id={block.id}
      data-block-type="divider"
      role="separator"
      aria-label="分隔线"
      tabIndex={interactive ? 0 : -1}
      onPointerDown={
        interactive ? () => store.getState().select({ kind: "block", blockId: block.id }) : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                if (e.key === "Enter") store.getState().select({ kind: "block", blockId: block.id });
                else store.getState().apply("删除模块", (doc) => deleteBlock(doc, { blockId: block.id }));
              }
            }
          : undefined
      }
    >
      <div
        className={`canvas-divider-line is-${align}`}
        style={align === "left" ? { width: "100%" } : align === "right" ? { width: "60%", marginLeft: "auto" } : { width: "60%" }}
      />
      {children}
    </div>
  );
});

/**
 * 行动按钮块（B2）：纯链接，无脚本能力。
 * - 编辑态（interactive）：点击 = 选中，绝不跳转；
 * - 预览/只读：渲染为可点 <a>；href 仅 http(s)（isSafeButtonHref 双重把关），
 *   非法/为空 → 禁用态 + 提示；
 * - 属性栏编辑文案/链接/对齐/主次样式。
 */
export const CanvasButtonBlockView = memo(function CanvasButtonBlockView({
  block,
  x,
  y,
  width,
  height,
  selected,
  store,
  interactive,
  children,
}: CanvasBlockViewProps & { block: CanvasButtonBlock }) {
  const safe = isSafeButtonHref(block.href);
  const clickable = !interactive && safe && block.href !== "";
  const className = `canvas-btn is-${block.variant} ${safe ? "" : "is-unsafe"}`;
  const style: CSSProperties = { marginLeft: block.align === "right" ? "auto" : undefined, marginRight: block.align === "center" ? "auto" : undefined };
  return (
    <div
      className={`canvas-block canvas-block-button group ${selected ? "is-selected" : ""}`}
      style={boxStyle(x, y, width, height, undefined)}
      data-block-id={block.id}
      data-block-type="button"
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-label={`行动按钮：${block.label}${safe ? "" : "（链接未设置或非法）"}`}
      onPointerDown={
        interactive
          ? (e) => {
              // 编辑态点击 = 选中，不跳转（B2）
              e.preventDefault();
              store.getState().select({ kind: "block", blockId: block.id });
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                store.getState().select({ kind: "block", blockId: block.id });
              }
            }
          : undefined
      }
    >
      {clickable ? (
        <a
          href={block.href}
          className={className}
          style={style}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {block.label}
        </a>
      ) : (
        <span
          className={`${className} is-disabled`}
          style={style}
          role="link"
          aria-disabled="true"
          title={safe ? "链接未设置（选中后在右侧属性栏填写）" : "链接非法：仅支持 http/https"}
        >
          {block.label}
        </span>
      )}
      {children}
    </div>
  );
});

/**
 * 来源状态徽章（E；阶段 5 修正状态机）：loading=探测在途（按可用渲染，不闪烁）；
 * ok=可达；missing=确认软删/硬删/无权限（「来源不可用」）；error=探测失败
 * （网络/服务异常 → 「来源状态未知」，不是来源被删）。任何状态都不隐藏快照。
 */
export function SourceStatusBadge({
  sourceRef,
  status,
}: {
  sourceRef: CanvasSourceRef;
  status: "loading" | "ok" | "missing" | "error";
}) {
  if (status === "ok" || status === "loading") return null;
  const unknown = status === "error";
  return (
    <span
      className={unknown ? "canvas-source-unknown-badge" : "canvas-source-missing-badge"}
      role="status"
      aria-label={unknown
        ? `来源${sourceRef.kind === "memo" ? "速记" : "资料"}状态未知（网络或服务异常）`
        : `来源${sourceRef.kind === "memo" ? "速记" : "资料"}不可用（已删除或无权限）`}
      title={unknown
        ? `来源状态暂时无法确认；快照仍保留（${sourceRef.title}）`
        : `来源已删除或无权限；快照仍保留（${sourceRef.title}）`}
    >
      {unknown ? "来源状态未知" : "来源不可用"}
    </span>
  );
}

/**
 * 资料引用卡片块（阶段 E）：整条资料的快照卡片。
 * title/text 是独立副本（属性栏可编辑，不回写来源）；底部来源行显示
 * 类型 + 快照时间 + 状态（不可达时标注，快照继续可见）。
 */
export const CanvasMaterialCardBlockView = memo(function CanvasMaterialCardBlockView({
  block,
  x,
  y,
  width,
  height,
  selected,
  store,
  interactive,
  sourceStatus,
  children,
}: CanvasBlockViewProps & {
  block: CanvasMaterialCardBlock;
  /** 来源可达性（use-source-status；探测在途按可用渲染）。 */
  sourceStatus: "loading" | "ok" | "missing" | "error";
}) {
  return (
    <div
      className={`canvas-block canvas-block-material group ${selected ? "is-selected" : ""}`}
      style={boxStyle(x, y, width, height, block.style)}
      data-block-id={block.id}
      data-block-type="materialCard"
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-label={`资料卡片：${block.title || "未命名"}`}
      onPointerDown={
        interactive ? () => store.getState().select({ kind: "block", blockId: block.id }) : undefined
      }
      onDoubleClick={
        interactive ? () => store.getState().select({ kind: "block", blockId: block.id }) : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                store.getState().select({ kind: "block", blockId: block.id });
              }
            }
          : undefined
      }
    >
      <div className="canvas-material-card">
        <div className="canvas-material-card-title">{block.title || "未命名资料"}</div>
        {block.text.trim() && <div className="canvas-material-card-text">{block.text}</div>}
        <div className="canvas-material-card-source">
          <span className="canvas-material-card-kind">
            {block.sourceRef.kind === "memo" ? "速记" : "资料"}
          </span>
          {block.sourceRef.updatedAt && (
            <span className="canvas-material-card-time">
              快照 {new Date(block.sourceRef.updatedAt).toLocaleDateString("zh-CN")}
            </span>
          )}
          <SourceStatusBadge sourceRef={block.sourceRef} status={sourceStatus} />
        </div>
      </div>
      {children}
    </div>
  );
});
