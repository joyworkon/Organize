/**
 * 构思画布布局引擎（docs/idea-canvas-plan.md §4，阶段 B1 增加 Region 层）。
 *
 * 单向流程：先定宽 → 测内容自然高度 → 算行高 → 算区块高 → 拉伸容器。
 * 本模块是纯函数：测量值由调用方注入（UI 层用隐藏 DOM 测量器），绝不把
 * 拉伸后的容器高度反馈进宽度计算，避免布局抖动。
 *
 * Region 几何决策（B1）：
 * - 版面内容宽 = width − 2×padding；
 * - 区块内宽 = 版面内容宽 − 2×regionPadding，regionPadding = region.style.padding ?? 0
 *   （缺省 0：v1 迁移文档不吃额外宽度，渲染几何逐像素不变）；
 * - 区块内行距/列距/块距 = region.style.rowGap ?? board.gap（缺省继承版面 gap，
 *   与 v1 行距语义一致）；
 * - 区块高 = regionPadding×2 + Σ(行高) + 行距×(行数−1)；
 * - 版面总高 = padding×2 + Σ(区块高) + gap×(区块数−1)。
 */

import {
  BLOCK_PADDING,
  COLUMN_MIN_WIDTH,
  CanvasBlock,
  CanvasBoard,
  CanvasDoc,
  CanvasRegion,
  CanvasSection,
  DIVIDER_CONTENT_HEIGHT,
  IMAGE_RATIO_WIDTH_PER_HEIGHT,
  MIN_TEXT_CONTENT_HEIGHT,
  imageNaturalHeight,
} from "./model";

/** 测量器：给定块与列内宽（已扣块内边距），返回内容自然高度。 */
export type CanvasMeasure = (block: CanvasBlock, innerWidth: number) => number;

/** 模块自身 chrome（上下内边距 + 上下 1px 边框）：内容高之外的最小盒高增量。 */
export const BLOCK_CHROME = BLOCK_PADDING * 2 + 2;

export interface SceneBlockBox {
  blockId: string;
  /** 世界坐标。 */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneColumn {
  columnId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blocks: SceneBlockBox[];
}

export interface SceneSection {
  sectionId: string;
  y: number;
  height: number;
  /** 实际生效的列宽（像素），与列一一对应。 */
  columnWidths: number[];
  columns: SceneColumn[];
}

export interface SceneRegion {
  regionId: string;
  /** 世界坐标（区块外框左上角）。 */
  y: number;
  height: number;
  sections: SceneSection[];
}

export interface SceneBoard {
  boardId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  regions: SceneRegion[];
}

export interface SceneFreeItem {
  itemId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface Scene {
  boards: SceneBoard[];
  freeItems: SceneFreeItem[];
}

export function boardContentWidth(board: CanvasBoard): number {
  return board.width - board.padding * 2;
}

/** 分区可分配给列的总宽（Σ列宽 + 列间距之和 = 分区内容宽）。 */
export function sectionAllocatableWidth(board: CanvasBoard, columnCount: number): number {
  return boardContentWidth(board) - board.gap * Math.max(0, columnCount - 1);
}

/** 区块内边距：显式 style.padding，缺省 0（B1 决策，迁移文档几何不变）。 */
export function regionPadding(board: CanvasBoard, region: CanvasRegion): number {
  return region.style?.padding ?? 0;
}

/** 区块内行/列/块间距：显式 style.rowGap，缺省继承版面 gap（B1 决策）。 */
export function regionGap(board: CanvasBoard, region: CanvasRegion): number {
  return region.style?.rowGap ?? board.gap;
}

/** 区块内宽（版面内容宽 − 2×区块内边距）。 */
export function regionInnerWidth(board: CanvasBoard, region: CanvasRegion): number {
  return boardContentWidth(board) - regionPadding(board, region) * 2;
}

/**
 * 列宽分配：columnWeights 归一化后按比例分配，严格满足
 * Σ列宽 + gap×(n-1) = 内容宽（规格 §4.1.2）。
 */
export function computeColumnWidthsForContent(
  contentWidth: number,
  gap: number,
  section: Pick<CanvasSection, "columnWeights" | "columns">,
): number[] {
  const gapTotal = gap * Math.max(0, section.columns.length - 1);
  const allocatable = Math.max(0, contentWidth - gapTotal);
  const weights = section.columns.map(
    (_, i) => (section.columnWeights[i] ?? 1) > 0 ? section.columnWeights[i] ?? 1 : 1,
  );
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0 || section.columns.length === 0) {
    return section.columns.map(() => allocatable / Math.max(1, section.columns.length));
  }
  // 像素取整补偿：最后一列吸收舍入误差，保证总和严格相等。
  const widths = weights.map((w) => Math.floor((w / total) * allocatable * 100) / 100);
  const sum = widths.reduce((s, w) => s + w, 0);
  widths[widths.length - 1] = Math.round((widths[widths.length - 1] + (allocatable - sum)) * 100) / 100;
  return widths;
}

/** 版面级列宽分配（版面内容宽 + 版面 gap；区块内布局请用 regionInnerWidth + regionGap）。 */
export function computeColumnWidths(
  board: Pick<CanvasBoard, "width" | "padding" | "gap">,
  section: Pick<CanvasSection, "columnWeights" | "columns">,
): number[] {
  return computeColumnWidthsForContent(board.width - board.padding * 2, board.gap, section);
}

/** 给定内容宽与间距下能否再加一列：所有列（含新列）都 ≥ COLUMN_MIN_WIDTH（规格 §3.3）。 */
export function canAddColumnAt(contentWidth: number, gap: number, columnCount: number): boolean {
  return (columnCount + 1) * COLUMN_MIN_WIDTH + columnCount * gap <= contentWidth;
}

/** 能否再加一列（版面级判定；区块内请用 canAddColumnAt(regionInnerWidth, regionGap, n)）。 */
export function canAddColumn(
  board: Pick<CanvasBoard, "width" | "padding" | "gap">,
  columnCount: number,
): boolean {
  return canAddColumnAt(board.width - board.padding * 2, board.gap, columnCount);
}

/**
 * 一文一图智能比例生效条件（A7）：属性栏按钮显示与 recomputeSmartSection
 * 重算共用本判定——两列、每列恰一个块、至少一个图片块（一文一图形态）。
 */
export function canSmartRecompute(section: {
  columns: { blocks: { type: string }[] }[];
}): boolean {
  if (section.columns.length !== 2) return false;
  if (!section.columns.every((c) => c.blocks.length === 1)) return false;
  return section.columns.some((c) => c.blocks[0].type === "image");
}

/**
 * 一文一图智能比例（规格 §4.2）：确定性算法，一次参考测量定宽，禁止用拉伸后
 * 高度反推宽度。
 *
 * @param contentWidth 分区内容宽
 * @param gap 列间距
 * @param textNaturalHeightAtRef 等分参考宽度下测得的文字自然高度 T
 * @param imageRatio 图片原始比例 r = naturalWidth / naturalHeight
 * @returns [文字列权重, 图片列权重]
 */
export function computeSmartWeights(args: {
  contentWidth: number;
  gap: number;
  textNaturalHeightAtRef: number;
  imageRatio: number;
}): [number, number] {
  const { contentWidth, gap, textNaturalHeightAtRef, imageRatio } = args;
  const refWidth = (contentWidth - gap) / 2;
  const t = Math.max(MIN_TEXT_CONTENT_HEIGHT, textNaturalHeightAtRef);
  const r = imageRatio > 0 ? imageRatio : 1;
  // 图片内容期望宽 = r × T；加回图片模块左右内边距得外宽。
  const imageOuter = r * t + BLOCK_PADDING * 2;
  const allocatable = contentWidth - gap;
  const min = Math.min(COLUMN_MIN_WIDTH, allocatable / 2);
  const lo = Math.max(allocatable * 0.25, min);
  const hi = Math.min(allocatable * 0.6, allocatable - min);
  const clamped = Math.min(Math.max(imageOuter, lo), Math.max(lo, hi));
  const textOuter = allocatable - clamped;
  return [textOuter, clamped];
}

/** 单列需要的高度：n 个等高块（内容 m + 模块 chrome）+ (n-1) 个纵距（规格 §4.1.4）。 */
export function columnRequiredHeight(
  naturalHeights: number[],
  gap: number,
  chrome: number = BLOCK_CHROME,
): number {
  if (naturalHeights.length === 0) return 0;
  const m = Math.max(...naturalHeights) + chrome;
  return naturalHeights.length * m + (naturalHeights.length - 1) * gap;
}

/**
 * 分区内每列每块的最终盒子（先定列宽，再测自然高，最后按垂直对齐放置）。
 * @param contentX 行内容区左上角世界 x（= 区块内容区左缘）
 * @param contentWidth 行内容宽（区块内宽）
 * @param regionGap 区块行距（列/块间距缺省值；行级 section.gap 优先）
 */
function layoutSection(
  section: CanvasSection,
  contentX: number,
  contentWidth: number,
  regionGap: number,
  sectionY: number,
  measure: CanvasMeasure,
): SceneSection {
  const gap = section.gap ?? regionGap;
  const columnWidths = computeColumnWidthsForContent(contentWidth, gap, section);
  const naturalPerColumn: number[][] = section.columns.map((column, i) =>
    column.blocks.map((block) => blockContentNaturalHeight(block, Math.max(1, columnWidths[i] - BLOCK_PADDING * 2), measure)),
  );
  const naturalColumnHeights = naturalPerColumn.map((heights) =>
    heights.reduce((sum, h) => sum + h + BLOCK_CHROME, 0) + Math.max(0, heights.length - 1) * gap,
  );
  const stretchColumnHeights = naturalPerColumn.map((heights) => columnRequiredHeight(heights, gap));
  const sectionHeight =
    stretchColumnHeights.length > 0 ? Math.max(...stretchColumnHeights) : 0;
  const align = section.verticalAlign ?? "stretch";

  let x = contentX;
  const columns: SceneColumn[] = section.columns.map((column, i) => {
    const width = columnWidths[i];
    const n = column.blocks.length;
    const blockHeight = n > 0 ? (sectionHeight - (n - 1) * gap) / n : 0;
    // 非拉伸对齐：块保持各自自然高，块串在列内按 align 放置（B2）。
    const naturalStack = naturalColumnHeights[i] ?? 0;
    const lead =
      align === "middle"
        ? (sectionHeight - naturalStack) / 2
        : align === "bottom"
          ? sectionHeight - naturalStack
          : 0;
    let y = sectionY + (align === "stretch" ? 0 : Math.max(0, lead));
    const blocks: SceneBlockBox[] = column.blocks.map((block, bi) => {
      const height = align === "stretch" ? blockHeight : (naturalPerColumn[i][bi] ?? blockHeight) + BLOCK_CHROME;
      const box: SceneBlockBox = { blockId: block.id, x, y, width, height };
      y += height + gap;
      return box;
    });
    const sceneColumn: SceneColumn = { columnId: column.id, x, y: sectionY, width, height: sectionHeight, blocks };
    x += width + gap;
    return sceneColumn;
  });

  return {
    sectionId: section.id,
    y: sectionY,
    height: sectionHeight,
    columnWidths,
    columns,
  };
}

/**
 * 块的内容自然高（不含块 chrome）：
 * - 图片：定比例容器锁高（ratio≠auto），否则按原比例（宽度/比例）；
 * - 分隔线：固定线盒高；
 * - 行动按钮：与文本同走测量（块拉伸时垂直居中由渲染层处理）；
 * - 文本：测量值夹到最小内容高。
 */
export function blockContentNaturalHeight(
  block: CanvasBlock,
  innerWidth: number,
  measure: CanvasMeasure,
): number {
  if (block.type === "image") {
    const ratio = block.ratio;
    if (ratio && ratio !== "auto") {
      return innerWidth / IMAGE_RATIO_WIDTH_PER_HEIGHT[ratio];
    }
    return imageNaturalHeight(block, innerWidth);
  }
  if (block.type === "divider") return DIVIDER_CONTENT_HEIGHT;
  if (block.type === "button") {
    return Math.max(MIN_TEXT_CONTENT_HEIGHT, measure(block, innerWidth));
  }
  return Math.max(MIN_TEXT_CONTENT_HEIGHT, measure(block, innerWidth));
}

/** 区块内每行的最终盒子（含区块内边距与行距，B1）。 */
function layoutRegion(
  board: CanvasBoard,
  region: CanvasRegion,
  regionY: number,
  measure: CanvasMeasure,
): SceneRegion {
  const pad = regionPadding(board, region);
  const gap = regionGap(board, region);
  const innerWidth = regionInnerWidth(board, region);
  const contentX = board.x + board.padding + pad;
  let y = regionY + pad;
  const sections: SceneSection[] = region.sections.map((section) => {
    const scene = layoutSection(section, contentX, innerWidth, gap, y, measure);
    y += scene.height + gap;
    return scene;
  });
  const height =
    region.sections.length > 0 ? y - gap + pad - regionY : pad * 2;
  return { regionId: region.id, y: regionY, height, sections };
}

/** 自由容器高度：文本按测量；图片按容器比例（ratio≠auto）或宽度/自然比例（auto）。 */
function freeItemHeight(
  item: CanvasDoc["freeItems"][number],
  measure: CanvasMeasure,
): number {
  const inner = Math.max(1, item.width - BLOCK_PADDING * 2);
  if (item.block.type === "image") {
    const ratio = item.block.ratio;
    if (ratio && ratio !== "auto") {
      // 容器比例锁高：contain/cover 在该容器内才有裁切空间（A5）。
      return inner / IMAGE_RATIO_WIDTH_PER_HEIGHT[ratio] + BLOCK_CHROME;
    }
    return imageNaturalHeight(item.block, inner) + BLOCK_CHROME;
  }
  const natural = item.block.text.trim()
    ? measure(item.block, inner)
    : MIN_TEXT_CONTENT_HEIGHT;
  return natural + BLOCK_CHROME;
}

/** 计算整张场景的世界坐标几何（B1：版面 → 区块 → 行 → 列 → 块）。 */
export function computeScene(doc: CanvasDoc, measure: CanvasMeasure): Scene {
  const boards: SceneBoard[] = doc.boards.map((board) => {
    let y = board.y + board.padding;
    const regions: SceneRegion[] = board.regions.map((region) => {
      const scene = layoutRegion(board, region, y, measure);
      y += scene.height + board.gap;
      return scene;
    });
    const height = board.regions.length > 0
      ? y - board.gap + board.padding - board.y
      : board.padding * 2;
    return {
      boardId: board.id,
      x: board.x,
      y: board.y,
      width: board.width,
      height,
      regions,
    };
  });
  const freeItems: SceneFreeItem[] = doc.freeItems.map((item) => ({
    itemId: item.id,
    x: item.x,
    y: item.y,
    width: item.width,
    height: freeItemHeight(item, measure),
    zIndex: item.zIndex,
  }));
  return { boards, freeItems };
}

/** 全部版面的包围盒（「适合全部」缩放用）。 */
export function sceneBounds(scene: Scene): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const board of scene.boards) extend(board.x, board.y, board.width, board.height);
  for (const item of scene.freeItems) extend(item.x, item.y, item.width, item.height);
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 拖列分隔线：把「每列目标像素宽」转成 manual 权重（≥COLUMN_MIN_WIDTH），
 * 总和不必精确等于可分配宽——computeColumnWidths 会按权重归一化。
 */
export function weightsFromPixelWidths(pixelWidths: number[]): number[] {
  return pixelWidths.map((w) => Math.max(COLUMN_MIN_WIDTH, w));
}

/**
 * 拖第 boundaryIndex 条列间分隔线（其左侧为第 boundaryIndex 列）：
 * 相邻两列按新左宽重新瓜分原两列像素宽，其余列不变。
 * 返回 manual 权重数组（像素宽比例）。
 */
export function manualWeightsFromDrag(
  currentWidths: number[],
  boundaryIndex: number,
  newLeftWidth: number,
): number[] {
  const leftOld = currentWidths[boundaryIndex] ?? COLUMN_MIN_WIDTH;
  const rightOld = currentWidths[boundaryIndex + 1] ?? COLUMN_MIN_WIDTH;
  const pairTotal = leftOld + rightOld;
  const clampedLeft = Math.max(
    COLUMN_MIN_WIDTH,
    Math.min(newLeftWidth, pairTotal - COLUMN_MIN_WIDTH),
  );
  const next = [...currentWidths];
  next[boundaryIndex] = clampedLeft;
  next[boundaryIndex + 1] = pairTotal - clampedLeft;
  return next;
}
