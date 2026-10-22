/**
 * 构思画布「导出页面为 PNG」的纯几何与命名逻辑（docs/idea-canvas-plan.md §3.5/§5/§7）。
 *
 * 导出对象 = 页面（board）的世界包围盒；与该矩形相交（含恰好压边）的自由元素
 * 一并纳入；连接线仅当 from/to 两端自由元素都纳入时才导出，其余省略。
 * 相交判定与 minimap / 适合全部共用 computeScene 场景几何（freeItemHeight），
 * 不猜固定高。光栅化编排（字体/图片/CSS 内联）见 components/canvas/canvas-board-export.tsx。
 */

import { findBoard, type CanvasDoc } from "./model";
import type { Scene } from "./layout";

export interface ExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardExportMembers {
  boardId: string;
  bounds: ExportBounds;
  /** 与页面相交（含压边）的自由元素 id。 */
  freeItemIds: string[];
  /** 两端自由元素都在导出集合内的连接线 id。 */
  connectorIds: string[];
}

/** 闭区间矩形相交；边界恰好重合（压边）也算相交（规格 §3.5）。 */
export function rectsIntersect(a: ExportBounds, b: ExportBounds): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

/** 计算某页面的导出成员：board 本身 + 相交 freeItems + 两端都在集合内的 connectors。 */
export function membersForBoardExport(
  doc: CanvasDoc,
  scene: Scene,
  boardId: string,
): BoardExportMembers | null {
  const sceneBoard = scene.boards.find((board) => board.boardId === boardId);
  if (!sceneBoard || !findBoard(doc, boardId)) return null;
  const bounds: ExportBounds = {
    x: sceneBoard.x,
    y: sceneBoard.y,
    width: sceneBoard.width,
    height: sceneBoard.height,
  };
  const freeItemIds = scene.freeItems
    .filter((item) => rectsIntersect(bounds, item))
    .map((item) => item.itemId);
  const included = new Set(freeItemIds);
  const connectorIds = (doc.connectors ?? [])
    .filter((edge) => included.has(edge.from) && included.has(edge.to))
    .map((edge) => edge.id);
  return { boardId, bounds, freeItemIds, connectorIds };
}

/** 文件名里的非法字符（控制字符 + Windows/macOS 保留符号）。 */
const FILENAME_UNSAFE = /[\u0000-\u001f<>:"/\\|?*]/g;

/** `{画布标题}-{页面名或未命名页面}.png`；去非法文件名字符，空名回退默认文案。 */
export function exportFileName(canvasTitle: string, boardName: string): string {
  const clean = (value: string, fallback: string) => {
    const trimmed = value.replace(FILENAME_UNSAFE, "").trim().replace(/[.\s]+$/, "");
    return trimmed || fallback;
  };
  return `${clean(canvasTitle, "未命名画布")}-${clean(boardName, "未命名页面")}.png`;
}

/** 导出分辨率：页面 CSS 像素 × devicePixelRatio，夹在 1–2，避免超大 PNG。 */
export function exportPixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(2, Math.max(1, devicePixelRatio));
}

/** 与 globals.css 的 .canvas-page 字体栈一致（导出离屏根与字体子集过滤共用）。 */
export const EXPORT_FONT_STACK = '"MiSans VF", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

/** 解析字体栈里的 family 名（去引号），用于匹配 @font-face。 */
export function fontFamiliesInStack(stack: string): string[] {
  return stack
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export type UnicodeRange = readonly (readonly [number, number])[];

/**
 * 解析 @font-face 的 unicode-range（如 "U+20,U+2013-2014,U+4??"）。
 * 空串返回 null（无范围限制）；非法片段忽略（浏览器同样忽略）。
 */
export function parseFontUnicodeRange(text: string): UnicodeRange | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const ranges: [number, number][] = [];
  for (const token of trimmed.split(",")) {
    const match = token.trim().match(/^[Uu]\+([0-9a-fA-F?]+)(?:-([0-9a-fA-F]+))?$/);
    if (!match) continue;
    const [, startRaw, endRaw] = match;
    if (startRaw.includes("?")) {
      ranges.push([
        parseInt(startRaw.replace(/\?/g, "0"), 16),
        parseInt(startRaw.replace(/\?/g, "f"), 16),
      ]);
      continue;
    }
    const lo = parseInt(startRaw, 16);
    const hi = endRaw ? parseInt(endRaw, 16) : lo;
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) continue;
    ranges.push([lo, hi]);
  }
  return ranges;
}

/**
 * 该 @font-face 是否需要进导出 SVG：无 unicode-range（或全部片段非法）按需要处理
 * （宁多勿漏，避免漏字体导致文字回落）；否则文本任一码点落在范围内才算需要。
 */
export function fontFaceNeededForText(text: string, ranges: UnicodeRange | null): boolean {
  if (!ranges || ranges.length === 0) return true;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    for (const [lo, hi] of ranges) {
      if (code >= lo && code <= hi) return true;
    }
  }
  return false;
}
