/**
 * 拖入/粘贴的指针命中测试（阶段 B2）。
 *
 * 拖入/粘贴以指针世界坐标命中的列/区块解析 explicit 插入目标
 *（resolveInsertTarget 的规则 1）：命中块 → 该块之后；命中列空白 → 列末尾；
 * 命中区块/版面 → 区块末尾；版面外 → null（走常规解析链）。
 * 坐标全部来自 computeScene 的场景几何，无手写补偿。
 */

import type { CanvasDoc } from "@/lib/canvas/model";
import type { Scene } from "@/lib/canvas/layout";
import type { ExplicitInsertPosition } from "@/lib/canvas/insert-target";

export function hitTestInsertPosition(
  doc: CanvasDoc,
  scene: Scene,
  wx: number,
  wy: number,
): ExplicitInsertPosition | null {
  // 后画的版面在上层：倒序命中
  for (let bi = doc.boards.length - 1; bi >= 0; bi -= 1) {
    const board = doc.boards[bi];
    const sceneBoard = scene.boards[bi];
    if (!sceneBoard) continue;
    if (wx < board.x || wx > board.x + board.width || wy < board.y || wy > board.y + sceneBoard.height) {
      continue;
    }
    // 版面内：逐区块命中
    for (let ri = 0; ri < board.regions.length; ri += 1) {
      const region = board.regions[ri];
      const sceneRegion = sceneBoard.regions[ri];
      if (!sceneRegion) continue;
      if (wy < sceneRegion.y || wy > sceneRegion.y + sceneRegion.height) continue;
      // 区块内：逐行逐列命中
      for (let si = 0; si < region.sections.length; si += 1) {
        const section = region.sections[si];
        const sceneSection = sceneRegion.sections[si];
        if (!sceneSection) continue;
        if (wy < sceneSection.y || wy > sceneSection.y + sceneSection.height) continue;
        for (let ci = 0; ci < section.columns.length; ci += 1) {
          const column = section.columns[ci];
          const sceneColumn = sceneSection.columns[ci];
          if (!sceneColumn) continue;
          if (wx < sceneColumn.x || wx > sceneColumn.x + sceneColumn.width) continue;
          // 列内：命中块 → 该块之后；列空白（块间隙/边缘）→ 列末尾
          for (let ki = 0; ki < column.blocks.length; ki += 1) {
            const box = sceneColumn.blocks[ki];
            if (wy >= box.y && wy <= box.y + box.height) {
              return {
                kind: "column",
                boardId: board.id,
                regionId: region.id,
                sectionId: section.id,
                columnId: column.id,
                afterBlockId: box.blockId,
              };
            }
          }
          return {
            kind: "column",
            boardId: board.id,
            regionId: region.id,
            sectionId: section.id,
            columnId: column.id,
          };
        }
        // 行内列间隙：取较近一侧列
        let best: { columnId: string; dist: number } | null = null;
        for (let ci = 0; ci < sceneSection.columns.length; ci += 1) {
          const sceneColumn = sceneSection.columns[ci];
          const center = sceneColumn.x + sceneColumn.width / 2;
          const dist = Math.abs(wx - center);
          if (!best || dist < best.dist) {
            best = { columnId: section.columns[ci].id, dist };
          }
        }
        if (best) {
          return {
            kind: "column",
            boardId: board.id,
            regionId: region.id,
            sectionId: section.id,
            columnId: (best as { columnId: string }).columnId,
          };
        }
      }
      // 区块内行间隙 → 区块末尾
      return { kind: "region-end", boardId: board.id, regionId: region.id };
    }
    // 版面内区块外（上下边距）→ 最后一个区块
    const lastRegion = board.regions[board.regions.length - 1];
    return { kind: "region-end", boardId: board.id, regionId: lastRegion?.id ?? "" };
  }
  return null;
}
