/**
 * 文本样式解析（docs/idea-canvas-plan.md §3.1/§5）。
 *
 * 测量器与渲染器共用本模块，保证「测出来的自然高」与「实际渲染高」一致。
 * 颜色不存原始色值，存色板键，CSS 变量随主题切换（见 globals.css 的画布色板）。
 */

import { effectiveTextStyle, type CanvasBlockStyle, type CanvasFontSizeTier, type CanvasTextBlock } from "./model";

export const FONT_SIZE_PX: Record<CanvasFontSizeTier, number> = {
  sm: 14,
  md: 16,
  lg: 28,
  xl: 40,
};

export const FONT_SIZE_LABELS: Record<CanvasFontSizeTier, string> = {
  sm: "小",
  md: "正文",
  lg: "标题",
  xl: "大标题",
};

export interface ResolvedTextStyle {
  fontSizePx: number;
  lineHeight: number;
  bold: boolean;
  align: "left" | "center" | "right";
  colorKey: string;
}

/** 与 globals.css 的 .canvas-text-content 样式严格一致。 */
export function resolveTextStyle(block: CanvasTextBlock): ResolvedTextStyle {
  const eff = effectiveTextStyle(block);
  const large = eff.fontSize === "lg" || eff.fontSize === "xl";
  return {
    fontSizePx: FONT_SIZE_PX[eff.fontSize],
    lineHeight: large ? 1.3 : 1.6,
    bold: eff.bold,
    align: eff.align,
    colorKey: eff.color,
  };
}

/** 测量缓存键：同样式 + 同宽 + 同文本才可复用测量值。 */
export function textStyleKey(block: CanvasTextBlock): string {
  const s = resolveTextStyle(block);
  return `${s.fontSizePx}/${s.lineHeight}/${s.bold ? 1 : 0}/${s.align}/${s.colorKey}`;
}

/** 文本块背景/圆角（容器级样式，不影响测量）。 */
export function resolveBoxStyle(style: CanvasBlockStyle | undefined): {
  backgroundKey: string;
  radius: number;
} {
  return {
    backgroundKey: style?.background ?? "",
    radius: style?.radius ?? 8,
  };
}

export const CANVAS_COLOR_KEYS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"] as const;
export const CANVAS_BG_KEYS = ["", "gray", "blue", "green", "yellow", "red", "purple"] as const;

export const COLOR_LABELS: Record<string, string> = {
  "": "默认",
  red: "红",
  orange: "橙",
  yellow: "黄",
  green: "绿",
  blue: "蓝",
  purple: "紫",
  gray: "灰",
};
