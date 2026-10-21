/** 列表只传紧凑预览；不包含文本全文、图片 URL 或源资料引用。 */
import { computeScene, type CanvasMeasure } from "./layout";
import { contentBounds, layoutMinimap, worldToMinimap, type Box } from "./minimap";
import type { CanvasBlock, CanvasFreeItemBlock } from "./model";
import { validateCanvasContent } from "./validation";

export interface CanvasSummaryShape extends Box {
  kind: "board" | "region" | "text" | "image" | "block";
}

export interface CanvasListSummary {
  pages: number;
  blocks: number;
  excerpt: string;
  /** 坐标在 0..1 内，按 16:10 绘制，最多 40 个；先容器后内容。 */
  shapes: CanvasSummaryShape[];
}

export const CANVAS_SUMMARY_MAX_SHAPES = 40;

function blockText(block: CanvasBlock | CanvasFreeItemBlock): string {
  if (block.type === "text" || block.type === "materialCard") return block.text;
  if (block.type === "embed") return block.title;
  return "";
}

/** 无 DOM 的粗略测高；实际结构、列宽与图片比例仍由原布局引擎计算。 */
const measure: CanvasMeasure = (block, width) => {
  const charsPerLine = Math.max(1, Math.floor(width / 16));
  return Math.max(1, blockText(block).split("\n").reduce(
    (lines, line) => lines + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)), 0,
  )) * 24;
};

export function summarizeCanvas(content: unknown): CanvasListSummary | null {
  const validation = validateCanvasContent(content, { allowMockImages: true });
  if (!validation.ok || !validation.doc) return null;
  const doc = validation.doc;
  let blocks = 0;
  let excerpt = "";
  const kinds = new Map<string, CanvasSummaryShape["kind"]>();
  const visit = (block: CanvasBlock | CanvasFreeItemBlock) => {
    blocks += 1;
    kinds.set(block.id, block.type === "image" ? "image" : block.type === "divider" || block.type === "button" || block.type === "shape" ? "block" : "text");
    if (!excerpt) excerpt = Array.from(blockText(block).split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "").slice(0, 80).join("");
  };
  for (const board of doc.boards) for (const region of board.regions) {
    for (const section of region.sections) for (const column of section.columns) for (const block of column.blocks) visit(block);
  }
  for (const item of doc.freeItems) visit(item.block);

  const scene = computeScene(doc, measure);
  const bounds = contentBounds(scene);
  if (!bounds) return { pages: doc.boards.length, blocks, excerpt, shapes: [] };
  const layout = layoutMinimap(bounds, 160, 100, 8);
  const shapes: CanvasSummaryShape[] = [];
  const add = (box: Box, kind: CanvasSummaryShape["kind"]) => {
    if (shapes.length >= CANVAS_SUMMARY_MAX_SHAPES) return;
    const origin = worldToMinimap(box.x, box.y, layout);
    const round = (n: number) => Math.round(n * 10000) / 10000;
    shapes.push({
      kind,
      x: round(origin.x / 160),
      y: round(origin.y / 100),
      width: round(box.width * layout.scale / 160),
      height: round(box.height * layout.scale / 100),
    });
  };
  // 优先给每个页面/自由项保留轮廓，避免第一个大页面吃掉全部图形预算。
  for (const board of scene.boards) add(board, "board");
  for (const [index, item] of scene.freeItems.entries()) {
    add(item, kinds.get(doc.freeItems[index].block.id) ?? "text");
  }
  for (const [index, board] of scene.boards.entries()) {
    const modelBoard = doc.boards[index];
    for (const region of board.regions) {
      add({
        x: board.x + modelBoard.padding,
        y: region.y,
        width: board.width - modelBoard.padding * 2,
        height: region.height,
      }, "region");
      for (const section of region.sections) for (const column of section.columns) for (const block of column.blocks) add(block, kinds.get(block.blockId) ?? "block");
    }
  }
  return { pages: doc.boards.length, blocks, excerpt, shapes };
}

/** 显式白名单投影：真实 API 与 mock 一致，content 永远不进入响应。 */
export function canvasListDto(row: { id: string; title: string; created_at: string; updated_at: string; content: unknown }) {
  return { id: row.id, title: row.title, created_at: row.created_at, updated_at: row.updated_at, summary: summarizeCanvas(row.content) };
}
