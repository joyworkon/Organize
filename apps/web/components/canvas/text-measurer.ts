"use client";

/**
 * 画布文本测量器：把「内容自然高度」的 DOM 测量收敛到一个隐藏容器。
 *
 * - warm()：一次写入全部待测样本、一次读取（单次 reflow），供整场景计算；
 * - measure()：带缓存的单点测量（编辑中的块每次击键只测一块）；
 * - 样式应用与真实渲染共用 applyCanvasTextStyle()，保证测得即所现
 *   （规格 §4.1：测量不使用 stretch 后的容器高度）。
 */

import { FONT_SIZE_LABELS } from "@/lib/canvas/text-styles";
import type { ResolvedTextStyle } from "@/lib/canvas/text-styles";
import { MIN_TEXT_CONTENT_HEIGHT } from "@/lib/canvas/model";

const CONTAINER_ID = "canvas-text-measure-root";

export interface TextMeasureRequest {
  key: string;
  text: string;
  style: ResolvedTextStyle;
  width: number;
}

/** 渲染与测量共用的文本样式应用（真源，勿在别处手写样式）。 */
export function applyCanvasTextStyle(el: HTMLElement, style: ResolvedTextStyle): void {
  el.style.fontSize = `${style.fontSizePx}px`;
  el.style.lineHeight = String(style.lineHeight);
  el.style.fontWeight = style.bold ? "700" : "400";
  el.style.textAlign = style.align;
  if (style.colorKey) {
    el.style.color = `var(--cv-text-${style.colorKey})`;
  } else {
    el.style.color = "";
  }
}

export class CanvasTextMeasurer {
  private container: HTMLDivElement | null = null;
  private cache = new Map<string, number>();

  attach(): void {
    if (this.container || typeof document === "undefined") return;
    let root = document.getElementById(CONTAINER_ID) as HTMLDivElement | null;
    if (!root) {
      root = document.createElement("div");
      root.id = CONTAINER_ID;
      root.setAttribute("aria-hidden", "true");
      Object.assign(root.style, {
        position: "fixed",
        left: "-99999px",
        top: "0",
        visibility: "hidden",
        pointerEvents: "none",
        zIndex: "-1",
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(root);
    }
    this.container = root;
  }

  detach(): void {
    this.container = null;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private static cacheKey(key: string, width: number): string {
    // 宽度按 0.5px 量化，吸收亚像素抖动
    return `${key}@${Math.round(width * 2) / 2}`;
  }

  private buildSample(req: TextMeasureRequest): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "canvas-text-content";
    applyCanvasTextStyle(el, req.style);
    el.style.width = `${Math.max(1, req.width)}px`;
    el.style.whiteSpace = "pre-wrap";
    el.style.overflowWrap = "anywhere";
    el.textContent = req.text;
    return el;
  }

  /** 批量预热：全部写入后统一读取，单次布局。 */
  warm(requests: TextMeasureRequest[]): void {
    if (!this.container) this.attach();
    const container = this.container;
    if (!container) return;
    const pending: { el: HTMLDivElement; cacheKey: string }[] = [];
    for (const req of requests) {
      const ck = CanvasTextMeasurer.cacheKey(req.key, req.width);
      if (this.cache.has(ck)) continue;
      const el = this.buildSample(req);
      container.appendChild(el);
      pending.push({ el, cacheKey: ck });
    }
    if (pending.length === 0) return;
    const heights = pending.map(({ el }) => Math.max(MIN_TEXT_CONTENT_HEIGHT, el.offsetHeight));
    pending.forEach(({ el }, i) => {
      this.cache.set(pending[i].cacheKey, heights[i]);
      el.remove();
    });
    if (this.cache.size > 4000) this.cache.clear();
  }

  /** 单点测量（优先缓存）。 */
  measure(text: string, key: string, style: ResolvedTextStyle, width: number): number {
    const ck = CanvasTextMeasurer.cacheKey(key, width);
    const hit = this.cache.get(ck);
    if (hit !== undefined) return hit;
    this.warm([{ key, text, style, width }]);
    const result = this.cache.get(ck);
    return result ?? MIN_TEXT_CONTENT_HEIGHT;
  }
}

export { FONT_SIZE_LABELS };
