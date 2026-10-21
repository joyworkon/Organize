import type { Scene } from "./layout";
import { findBlockLocation, type CanvasDoc } from "./model";
import type { InsertSelection } from "./insert-target";

/** 翻页方向：1 下一页 / -1 上一页 / 0 非翻页键。 */
export type PreviewPageStep = 1 | -1 | 0;

interface Rect { x: number; y: number; width: number; height: number }

/** 矩形重叠面积（不相交为 0）。 */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * 若干世界矩形与候选页面按「重叠面积最大，其次中心距离最近」定序，
 * 取第一个页面 id。页面矩形缺失（scene 未含该 board）时跳过该候选。
 */
function nearestBoardId(boxes: Rect[], boards: { boardId: string; x: number; y: number; width: number; height: number }[]): string | null {
  let bestId: string | null = null;
  let bestOverlap = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const board of boards) {
    let boardOverlap = 0;
    let boardDistance = Number.POSITIVE_INFINITY;
    for (const box of boxes) {
      boardOverlap += overlapArea(box, board);
      const dc = center(box);
      const db = center(board);
      boardDistance = Math.min(boardDistance, Math.hypot(dc.x - db.x, dc.y - db.y));
    }
    if (boardOverlap <= 0 && boardDistance === Number.POSITIVE_INFINITY) continue;
    if (boardOverlap > 0 && (bestId === null || boardOverlap > bestOverlap)) {
      bestId = board.boardId;
      bestOverlap = boardOverlap;
      continue;
    }
    if (boardOverlap <= 0 && bestOverlap <= 0 && boardDistance < bestDistance) {
      bestId = board.boardId;
      bestDistance = boardDistance;
    }
  }
  return bestId;
}

/**
 * 进入预览时的落页（任务 A）：
 * - 选区落在页面/区块/模块上 → 所在页面；
 * - 自由元素 / 连接线 → 几何上重叠（面积最大）或最近（中心距）的页面；
 * - 无选区、选区失效或找不到归属 → 文档第一张页面；
 * - 无页面 → null（保持空画布预览，不报错）。
 */
export function resolvePreviewBoardId(
  doc: CanvasDoc,
  scene: Pick<Scene, "boards" | "freeItems">,
  selection: InsertSelection,
): string | null {
  if (doc.boards.length === 0) return null;
  const fallback = doc.boards[0].id;
  if (!selection) return fallback;
  if (selection.kind === "board") {
    return doc.boards.some((b) => b.id === selection.boardId) ? selection.boardId : fallback;
  }
  if (selection.kind === "region") {
    return doc.boards.some((b) => b.id === selection.boardId) ? selection.boardId : fallback;
  }
  if (selection.kind === "block" || selection.kind === "blocks") {
    const ids = selection.kind === "block" ? [selection.blockId] : selection.blockIds;
    for (const id of ids) {
      const board = findBlockLocation(doc, id)?.board;
      if (board) return board.id;
    }
    return fallback;
  }
  // 自由元素 / 连接线：按几何归属解析
  const edge = selection.kind === "connector"
    ? doc.connectors?.find((entry) => entry.id === selection.connectorId)
    : undefined;
  const itemIds =
    selection.kind === "free" ? [selection.itemId]
    : selection.kind === "frees" ? selection.itemIds
    : edge ? [edge.from, edge.to]
    : [];
  const ids = new Set(itemIds);
  const boxes = scene.freeItems.filter((f) => ids.has(f.itemId));
  if (boxes.length === 0) return fallback;
  return nearestBoardId(boxes, scene.boards) ?? fallback;
}

/**
 * 预览翻页（任务 B）：按 doc.boards 顺序循环取第 current+delta 张页面。
 * 无页面返回 null；current 失效时正向往第一张、反向往最后一张。
 */
export function stepPreviewBoardId(doc: CanvasDoc, currentBoardId: string | null, step: 1 | -1): string | null {
  const total = doc.boards.length;
  if (total === 0) return null;
  const index = doc.boards.findIndex((b) => b.id === currentBoardId);
  if (index < 0) return step > 0 ? doc.boards[0].id : doc.boards[total - 1].id;
  return doc.boards[(index + step + total) % total].id;
}

/**
 * 预览翻页按键（任务 B）：→ / PageDown / Space 下一页，
 * ← / PageUp / Shift+Space 上一页；修饰键组合与非翻页键返回 0。
 * 匹配留在 canvas-workspace 的 keydown（依赖 previewMode 守卫），不进 matchCanvasShortcut。
 */
export function previewPageStep(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): PreviewPageStep {
  if (e.metaKey || e.ctrlKey || e.altKey) return 0;
  if (e.key === "ArrowRight" || e.key === "PageDown") return 1;
  if (e.key === "ArrowLeft" || e.key === "PageUp") return -1;
  if (e.code === "Space" || e.key === " ") return e.shiftKey ? -1 : 1;
  return 0;
}
