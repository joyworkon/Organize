"use client";

/**
 * useCanvasScene：把文档 + DOM 测量接到纯布局引擎 computeScene。
 *
 * 流程严格单向（规格 §4.1）：列宽由权重直接算出（无需测量）→ 收集全部
 * 文本测量请求 → 批量预热（单次 reflow）→ computeScene 查缓存得到几何。
 * 拉伸高度永不回流进测量。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BLOCK_PADDING,
  CanvasBlock,
  CanvasDoc,
  CanvasTextBlock,
} from "@/lib/canvas/model";
import {
  computeColumnWidthsForContent,
  computeScene,
  regionGap,
  regionInnerWidth,
  type CanvasMeasure,
  type Scene,
} from "@/lib/canvas/layout";
import { resolveTextStyle, textStyleKey } from "@/lib/canvas/text-styles";
import { CanvasTextMeasurer } from "./text-measurer";

function collectTextRequests(doc: CanvasDoc) {
  const requests: {
    block: CanvasTextBlock;
    key: string;
    style: ReturnType<typeof resolveTextStyle>;
    width: number;
  }[] = [];
  for (const board of doc.boards) {
    for (const region of board.regions) {
      const regionWidth = regionInnerWidth(board, region);
      const gap = regionGap(board, region);
      for (const section of region.sections) {
        const widths = computeColumnWidthsForContent(regionWidth, gap, section);
        section.columns.forEach((column, i) => {
          const colInner = Math.max(1, (widths[i] ?? 0) - BLOCK_PADDING * 2);
          for (const block of column.blocks) {
            if (block.type === "text") {
              requests.push({
                block,
                key: textStyleKey(block),
                style: resolveTextStyle(block),
                width: colInner,
              });
            }
          }
        });
      }
    }
  }
  // 自由文本容器
  for (const item of doc.freeItems) {
    if (item.block.type === "text") {
      const inner = Math.max(1, item.width - BLOCK_PADDING * 2);
      requests.push({
        block: item.block,
        key: textStyleKey(item.block),
        style: resolveTextStyle(item.block),
        width: inner,
      });
    }
  }
  return requests;
}

export function useCanvasScene(
  doc: CanvasDoc,
  opts: { measureEpoch: number; fontsReady: boolean },
): { scene: Scene; measurer: CanvasTextMeasurer } {
  const measurerRef = useRef<CanvasTextMeasurer | null>(null);
  if (!measurerRef.current) measurerRef.current = new CanvasTextMeasurer();
  const measurer = measurerRef.current;

  useEffect(() => {
    measurer.attach();
    return () => measurer.detach();
  }, [measurer]);

  // 字体加载完成或样式失效时清空测量缓存
  useEffect(() => {
    measurer.clearCache();
  }, [measurer, opts.measureEpoch, opts.fontsReady]);

  const scene = useMemo(() => {
    const requests = collectTextRequests(doc);
    measurer.warm(
      requests.map((r) => ({ key: r.key, text: r.block.text, style: r.style, width: r.width })),
    );
    const measure: CanvasMeasure = (block: CanvasBlock, innerWidth: number) => {
      if (block.type === "text") {
        return measurer.measure(block.text, textStyleKey(block), resolveTextStyle(block), innerWidth);
      }
      if (block.type === "button") {
        // 行动按钮按标签文案测量（14px 正文行高），与渲染一致（B2）
        return measurer.measure(
          block.label,
          `btn|${block.variant}`,
          { fontSizePx: 14, lineHeight: 1.6, bold: false, align: block.align, colorKey: "" },
          innerWidth,
        );
      }
      if (block.type === "materialCard") {
        // 资料卡片（E）：标题（15px 加粗）+ 摘录（13px）+ 来源标签行，与渲染一致
        const titleStyle = { fontSizePx: 15, lineHeight: 1.4, bold: true, align: "left" as const, colorKey: "" };
        const titleH = measurer.measure(block.title || " ", `mc-t|${block.sourceRef.kind}:${block.sourceRef.id}`, titleStyle, innerWidth);
        const bodyStyle = { fontSizePx: 13, lineHeight: 1.5, bold: false, align: "left" as const, colorKey: "" };
        const textH = block.text.trim()
          ? measurer.measure(block.text, `mc-b|${block.id}`, bodyStyle, innerWidth)
          : 0;
        return titleH + (textH > 0 ? textH + 6 : 0) + 24; // 24 = 来源标签行高 + 间距
      }
      return 0; // 图片/分隔线高度由 layout.ts 按比例/固定值计算，不走文本测量
    };
    return computeScene(doc, measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, measurer, opts.measureEpoch, opts.fontsReady]);

  return { scene, measurer };
}

/**
 * 字体就绪订阅（MiSans VF 自托管，PR #319）。
 * 优先消费 FontReadyBridge 的 organize:fonts-ready 事件与 data-fonts-ready 标记；
 * document.fonts.ready 仅作桥未挂载时的兜底。就绪翻转触发画布整体重测。
 */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.documentElement.dataset.fontsReady === "true") {
      setReady(true);
      return;
    }
    const onReady = () => setReady(true);
    window.addEventListener("organize:fonts-ready", onReady);
    let cancelled = false;
    if ("fonts" in document) {
      document.fonts.ready.then(() => {
        if (!cancelled) setReady(true);
      });
    } else {
      setReady(true);
    }
    return () => {
      cancelled = true;
      window.removeEventListener("organize:fonts-ready", onReady);
    };
  }, []);
  return ready;
}
