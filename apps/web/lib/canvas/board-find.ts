/** 画布内只读查找：按文档顺序，每对象只保留首个字面量命中。 */
import type { CanvasBlock, CanvasDoc, CanvasFocus } from "./model";

type FindTarget = Exclude<CanvasFocus, null | { kind: "blocks" | "frees" }>;
export interface CanvasFindHit {
  id: string;
  kind: FindTarget["kind"];
  target: FindTarget;
  snippet: { before: string; match: string; after: string };
}

function blockText(block: CanvasBlock): string {
  if (block.type === "text" || block.type === "materialCard") return block.text;
  if (block.type === "button") return block.label;
  if (block.type === "embed") return block.title;
  return "";
}

export function findCanvasContent(doc: CanvasDoc, query: string, limit = 100): CanvasFindHit[] {
  const q = query.trim();
  if (!q || limit <= 0) return [];
  const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const hits: CanvasFindHit[] = [];
  const add = (text: string, id: string, target: FindTarget) => {
    if (hits.length >= limit) return;
    const match = pattern.exec(text);
    if (!match) return;
    const start = match.index;
    const end = start + match[0].length;
    hits.push({ id, kind: target.kind, target, snippet: {
      before: text.slice(Math.max(0, start - 24), start),
      match: match[0],
      after: text.slice(end, end + 24),
    } });
  };
  for (const board of doc.boards) {
    add(board.name ?? "", board.id, { kind: "board", boardId: board.id });
    for (const region of board.regions) {
      add(region.name, region.id, { kind: "region", boardId: board.id, regionId: region.id });
      for (const section of region.sections) for (const column of section.columns) for (const block of column.blocks) {
        add(blockText(block), block.id, {
          kind: "block", boardId: board.id, regionId: region.id,
          sectionId: section.id, columnId: column.id, blockId: block.id,
        });
      }
    }
    if (hits.length >= limit) return hits;
  }
  for (const item of doc.freeItems) {
    if (item.block.type === "text") add(item.block.text, item.id, { kind: "free", itemId: item.id });
    if (hits.length >= limit) return hits;
  }
  for (const edge of doc.connectors ?? []) {
    add(edge.label, edge.id, { kind: "connector", connectorId: edge.id });
    if (hits.length >= limit) break;
  }
  return hits;
}
