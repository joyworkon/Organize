/**
 * 统一插入解析（阶段 B2）。
 *
 * 所有添加入口（左侧添加面板、块下＋、行边缘＋、区块间＋、Enter、
 * 图片三入口、模板插入）先经 resolveInsertTarget 解析出落点，再由
 * commands.insertBlockAtTarget 落块。解析是纯函数：doc + selection + explicit
 * + lastActive → InsertTarget，便于逐条单测。
 *
 * 规则（顺序即优先级）：
 * 1. explicit（明确点了某个「＋」/拖入命中位置）→ 该位置（锚点已失效则降级走下一条）；
 * 2. 选中内容块 → 同列该块之后；
 * 3. 选中列（UI 无列选中态，本档跳过）；
 * 4. 选中区块 → 区块末尾追加一行，放首列；
 * 5. 选中页面 → 页面最后一个区块（没有区块则创建）；新增内容一律落在区块内，
 *    不默认创建脱离页面的自由内容；
 * 6. 无选中 → store 记忆的最近有效页面 + 区块（lastActiveTarget）；
 * 7. 完全空白（无可用页面/区块）→ { create: "page" }，由调用方先建页面再二次解析。
 */

import {
  CanvasDoc,
  findBlockLocation,
  findBoard,
  findRegion,
} from "./model";

/** 列级落点：afterBlockId 存在 = 插在该块之后；否则追加到该列末尾。 */
export interface InsertColumnTarget {
  kind: "column";
  boardId: string;
  regionId: string;
  sectionId: string;
  columnId: string;
  afterBlockId?: string;
}

/** 区块末尾落点：在该区块末尾追加一行（首列放新块）。 */
export interface InsertRegionEndTarget {
  kind: "region-end";
  boardId: string;
  regionId: string;
}

/** 空白文档：调用方先自动创建页面（+ 默认区块）再插入。 */
export interface InsertCreatePageTarget {
  create: "page";
}

export type InsertTarget = InsertColumnTarget | InsertRegionEndTarget | InsertCreatePageTarget;

/** store 记忆的最近有效落点（页面 + 区块），内存持久、不落盘。 */
export interface LastActiveTarget {
  boardId: string;
  regionId: string;
}

export type InsertSelection =
  | { kind: "block"; blockId: string }
  | { kind: "free"; itemId: string }
  | { kind: "board"; boardId: string }
  | { kind: "region"; boardId: string; regionId: string }
  | null;

/** 明确的「＋」位置（块下＋/行边缘＋/区块间＋/拖入命中列）。 */
export type ExplicitInsertPosition =
  | { kind: "column"; boardId: string; regionId: string; sectionId: string; columnId: string; afterBlockId?: string }
  | { kind: "region-end"; boardId: string; regionId: string };

/** explicit 指向的锚点是否仍然存在（区块/行/列/块 id 全链路校验）。 */
function isExplicitAlive(doc: CanvasDoc, explicit: ExplicitInsertPosition): boolean {
  if (explicit.kind === "region-end") {
    return findRegion(doc, explicit.regionId)?.board.id === explicit.boardId;
  }
  const board = findBoard(doc, explicit.boardId);
  if (!board) return false;
  const region = board.regions.find((r) => r.id === explicit.regionId);
  const section = region?.sections.find((s) => s.id === explicit.sectionId);
  const column = section?.columns.find((c) => c.id === explicit.columnId);
  if (!region || !section || !column) return false;
  if (explicit.afterBlockId && !column.blocks.some((b) => b.id === explicit.afterBlockId)) {
    return false;
  }
  return true;
}

/**
 * 解析插入落点（规则见文件头注释）。lastActive 仅在无选中时参与（规则 6）。
 */
export function resolveInsertTarget(
  doc: CanvasDoc,
  selection: InsertSelection,
  explicit?: ExplicitInsertPosition | null,
  lastActive?: LastActiveTarget | null,
): InsertTarget {
  // 1. 明确点击某个「＋」
  if (explicit && isExplicitAlive(doc, explicit)) {
    return explicit.kind === "column"
      ? {
          kind: "column",
          boardId: explicit.boardId,
          regionId: explicit.regionId,
          sectionId: explicit.sectionId,
          columnId: explicit.columnId,
          afterBlockId: explicit.afterBlockId,
        }
      : { kind: "region-end", boardId: explicit.boardId, regionId: explicit.regionId };
  }

  // 2. 选中内容块 → 同列该块之后
  if (selection?.kind === "block") {
    const loc = findBlockLocation(doc, selection.blockId);
    if (loc) {
      return {
        kind: "column",
        boardId: loc.board.id,
        regionId: loc.region.id,
        sectionId: loc.section.id,
        columnId: loc.column.id,
        afterBlockId: loc.block.id,
      };
    }
  }

  // 3. 选中列：UI 无列选中态，跳过。

  // 4. 选中区块 → 区块末尾追加一行
  if (selection?.kind === "region") {
    const found = findRegion(doc, selection.regionId);
    if (found && found.board.id === selection.boardId) {
      return { kind: "region-end", boardId: selection.boardId, regionId: selection.regionId };
    }
  }

  // 5. 选中页面 → 最后一个区块（页面暂无区块时给空 regionId，
  //    insertBlockAtTarget 会自建默认区块）
  if (selection?.kind === "board") {
    const board = findBoard(doc, selection.boardId);
    if (board) {
      const lastRegion = board.regions[board.regions.length - 1];
      return { kind: "region-end", boardId: board.id, regionId: lastRegion?.id ?? "" };
    }
  }

  // 6. 无选中（或选中对象已失效）→ 最近有效页面 + 区块
  if (lastActive) {
    const found = findRegion(doc, lastActive.regionId);
    if (found && found.board.id === lastActive.boardId) {
      return { kind: "region-end", boardId: lastActive.boardId, regionId: lastActive.regionId };
    }
  }
  // lastActive 失效但文档里还有页面：退化为最后一个页面的最后一个区块
  // （仍属「最近有效」语义；真正的完全空白才走 create:"page"）
  const lastBoard = doc.boards[doc.boards.length - 1];
  if (lastBoard) {
    const lastRegion = lastBoard.regions[lastBoard.regions.length - 1];
    return { kind: "region-end", boardId: lastBoard.id, regionId: lastRegion?.id ?? "" };
  }

  // 7. 完全空白 → 自动创建页面
  return { create: "page" };
}

/** 工作区「添加到：X」提示文案。 */
export function describeInsertTarget(doc: CanvasDoc, target: InsertTarget): string {
  if ("create" in target) return "添加到：新页面";
  const found = findRegion(doc, target.regionId);
  const name = found?.region.name ?? "新页面";
  return `添加到：${name}`;
}
