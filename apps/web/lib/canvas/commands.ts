/**
 * 构思画布结构命令（docs/idea-canvas-plan.md §6.1，阶段 B1 适配 Region 层）。
 *
 * 全部为纯函数：(doc, args) → { doc, focus }。不触碰 DOM、不发请求、
 * 不进入 setState 更新器——保存与上传由 UI 层在事件处理器中执行。
 * 同一操作就是一个可撤销事务（历史由 components/canvas 的 store 记录）。
 * 文档永远写 schemaVersion=2（读取侧统一走 ensureCanvasDocV2 迁移）。
 */

import {
  BOARD_DEFAULT_WIDTH,
  BOARD_MAX_WIDTH,
  BOARD_MIN_WIDTH,
  BLOCK_PADDING,
  CANVAS_SCHEMA_VERSION,
  CanvasBlock,
  CanvasBoard,
  CanvasButtonVariant,
  CanvasCommandResult,
  CanvasDoc,
  CanvasFocus,
  CanvasFreeItem,
  CanvasIdGenerator,
  CanvasImageAsset,
  CanvasImageBlock,
  CanvasImageRatio,
  CanvasRegion,
  CanvasSectionVerticalAlign,
  CanvasSectionWidthMode,
  CanvasTextAlign,
  CanvasTextBlock,
  CanvasTextRole,
  MIN_TEXT_CONTENT_HEIGHT,
  defaultIdGenerator,
  createBoardShape,
  createColumn,
  createImageBlock,
  createRegion,
  createSection,
  createTextBlock,
  findBlockLocation,
  findBoard,
  findFreeItem,
  findRegion,
  findSection,
  imageNaturalHeight,
  normalizeBoardAfterDeletion,
} from "./model";
import { BLOCK_CHROME, manualWeightsFromDrag } from "./layout";

/**
 * 深拷贝后在草稿上应用变更，保证命令无副作用（历史快照同源）。
 * mutator 只允许操作 draft。
 */
function edit(
  doc: CanvasDoc,
  mutate: (draft: CanvasDoc) => CanvasFocus | void,
): CanvasCommandResult {
  const draft: CanvasDoc = structuredClone(doc);
  draft.schemaVersion = CANVAS_SCHEMA_VERSION;
  const focus = mutate(draft);
  return { doc: draft, focus: focus ?? null };
}

function focusBlock(
  board: CanvasBoard,
  region: CanvasRegion,
  sectionId: string,
  columnId: string,
  block: CanvasBlock,
  extra?: { caret?: "start" | "end" | "select-all"; edit?: boolean },
): CanvasFocus {
  return {
    kind: "block",
    boardId: board.id,
    regionId: region.id,
    sectionId,
    columnId,
    blockId: block.id,
    caret: extra?.caret,
    edit: extra?.edit,
  } satisfies CanvasFocus;
}

// ---------------------------------------------------------------------------
// 版面（页面）
// ---------------------------------------------------------------------------

/** 双击空白：在指针世界坐标建立版面，标题聚焦（规格 §3.1）。 */
export function createBoard(
  doc: CanvasDoc,
  args: { x: number; y: number; boardId?: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = createBoardShape({ x: args.x, y: args.y }, newId);
    if (args.boardId) board.id = args.boardId;
    draft.boards.push(board);
    const region = board.regions[0];
    const title = region.sections[0].columns[0].blocks[0] as CanvasTextBlock;
    return focusBlock(board, region, region.sections[0].id, region.sections[0].columns[0].id, title, {
      caret: "end",
      edit: true,
    });
  });
}

/** 工具栏「新建版面」：视口世界矩形内网格扫描（真实包围盒重叠检测）。 */
export interface CanvasViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 新版面初始包围盒估算高（标题 + 正文最小内容高，足够做重叠判定）。 */
const AUTO_PLACE_BOARD_HEIGHT = 240;

function autoPlaceFreeItemHeight(item: CanvasFreeItem): number {
  const inner = Math.max(1, item.width - BLOCK_PADDING * 2);
  if (item.block.type === "image") {
    return imageNaturalHeight(item.block, inner) + BLOCK_CHROME;
  }
  return MIN_TEXT_CONTENT_HEIGHT + BLOCK_CHROME;
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

/**
 * A 阶段视口落位逻辑（B1 抽出与 createBoardSkeleton 共用）：
 * 从视口世界矩形左上角按固定网格扫描，候选位与现有版面/自由容器做包围盒重叠检测；
 * 矩形内找不到空位时落在视口中心（允许重叠，但保证在视口内）；
 * 无视口信息时退回原点网格。
 */
export function pickAutoPlacePosition(
  doc: CanvasDoc,
  viewport?: CanvasViewportRect | null,
): { x: number; y: number } {
  const step = BOARD_DEFAULT_WIDTH + 80;
  const boardW = BOARD_DEFAULT_WIDTH;
  const boardH = AUTO_PLACE_BOARD_HEIGHT;
  const occupied = [
    ...doc.boards.map((b) => ({ x: b.x, y: b.y, width: b.width, height: AUTO_PLACE_BOARD_HEIGHT })),
    ...doc.freeItems.map((f) => ({
      x: f.x,
      y: f.y,
      width: f.width,
      height: autoPlaceFreeItemHeight(f),
    })),
  ];
  if (viewport && viewport.width >= boardW && viewport.height >= boardH) {
    const perRow = Math.max(1, Math.floor((viewport.width - boardW) / step) + 1);
    const rowStep = step + 60;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const x = viewport.x + (attempt % perRow) * step;
      const y = viewport.y + Math.floor(attempt / perRow) * rowStep;
      if (y + boardH > viewport.y + viewport.height) break; // 超出视口下缘，更靠后的行只会更低
      const candidate = { x, y, width: boardW, height: boardH };
      if (!occupied.some((o) => rectsOverlap(candidate, o))) {
        return { x, y };
      }
    }
    // 视口被占满：落在视口中心（允许与现有对象重叠，但必须在视口内）
    const cx = viewport.x + Math.max(0, (viewport.width - boardW) / 2);
    const cy = viewport.y + Math.max(0, (viewport.height - boardH) / 2);
    return { x: cx, y: cy };
  }
  const occupiedAt = new Set(doc.boards.map((b) => `${Math.round(b.x)},${Math.round(b.y)}`));
  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const col = attempt % 4;
    const row = Math.floor(attempt / 4);
    x = col * step;
    y = row * (step + 60);
    if (!occupiedAt.has(`${x},${y}`)) break;
  }
  return { x, y };
}

/**
 * 工具栏「新建版面」：优先落在当前视口世界矩形内（A 阶段逻辑，现抽出共用）。
 */
export function createBoardAutoPlace(
  doc: CanvasDoc,
  viewport?: CanvasViewportRect | null,
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  const at = pickAutoPlacePosition(doc, viewport);
  return createBoard(doc, at, newId);
}

/** 新建页面骨架变体（B1）：blank = 一个默认区块 + 标题块；landing = 头部/中部/底部三区块。 */
export type CanvasBoardSkeletonVariant = "blank" | "landing";

/** 落地页骨架的占位提示文字（用户可编辑/替换，不伪造宣传事实）。 */
const LANDING_PLACEHOLDER_TITLE = "点击输入标题";
const LANDING_PLACEHOLDER_MIDDLE = "点击输入正文";
const LANDING_PLACEHOLDER_BOTTOM = "点击输入底部内容";

/**
 * 新建页面骨架（B1）：落位走 A 阶段视口逻辑（可传 at 覆盖，如双击指针坐标）；
 * 占位块用提示文字。focus 到首个标题块并进入编辑。
 */
export function createBoardSkeleton(
  doc: CanvasDoc,
  args: { viewportRect?: CanvasViewportRect | null; at?: { x: number; y: number }; variant: CanvasBoardSkeletonVariant },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const at = args.at ?? pickAutoPlacePosition(draft, args.viewportRect ?? null);
    const board = createBoardShape(at, newId);
    board.regions = [];
    if (args.variant === "landing") {
      const headSection = createSection(
        [createColumn([createTextBlock("title", LANDING_PLACEHOLDER_TITLE, newId)], newId)],
        newId,
      );
      const middleSection = createSection(
        [createColumn([createTextBlock("body", LANDING_PLACEHOLDER_MIDDLE, newId)], newId)],
        newId,
      );
      const bottomSection = createSection(
        [createColumn([createTextBlock("body", LANDING_PLACEHOLDER_BOTTOM, newId)], newId)],
        newId,
      );
      board.regions = [
        createRegion([headSection], newId, "头部"),
        createRegion([middleSection], newId, "中部"),
        createRegion([bottomSection], newId, "底部"),
      ];
    } else {
      const titleSection = createSection(
        [createColumn([createTextBlock("title", "", newId)], newId)],
        newId,
      );
      board.regions = [createRegion([titleSection], newId)];
    }
    draft.boards.push(board);
    const region = board.regions[0];
    const title = region.sections[0].columns[0].blocks[0] as CanvasTextBlock;
    return focusBlock(board, region, region.sections[0].id, region.sections[0].columns[0].id, title, {
      caret: "end",
      edit: true,
    });
  });
}

export function moveBoard(
  doc: CanvasDoc,
  args: { boardId: string; x: number; y: number },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (board) {
      board.x = args.x;
      board.y = args.y;
    }
    return { kind: "board", boardId: args.boardId };
  });
}

export function resizeBoard(
  doc: CanvasDoc,
  args: { boardId: string; width: number },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (board) {
      board.width = Math.round(Math.min(BOARD_MAX_WIDTH, Math.max(BOARD_MIN_WIDTH, args.width)));
    }
    return { kind: "board", boardId: args.boardId };
  });
}

export function updateBoardStyle(
  doc: CanvasDoc,
  args: { boardId: string; style: { background?: string | null; radius?: number | null } },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (board) board.style = { ...board.style, ...args.style };
    return { kind: "board", boardId: args.boardId };
  });
}

/** 页面改名（B1）；空名归一为 undefined（不落库空串名）。 */
export function renameBoard(
  doc: CanvasDoc,
  args: { boardId: string; name: string },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (board) {
      const name = args.name.trim();
      board.name = name === "" ? undefined : name.slice(0, 100);
    }
    return { kind: "board", boardId: args.boardId };
  });
}

export function deleteBoard(doc: CanvasDoc, args: { boardId: string }): CanvasCommandResult {
  return edit(doc, (draft) => {
    draft.boards = draft.boards.filter((b) => b.id !== args.boardId);
    return null;
  });
}

// ---------------------------------------------------------------------------
// 区块（Region，B1 新增层）
// ---------------------------------------------------------------------------

/** 区块改名（B1）；超长截断到上限，空名归一为默认「内容」。 */
export function renameRegion(
  doc: CanvasDoc,
  args: { boardId: string; regionId: string; name: string },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findRegion(draft, args.regionId);
    if (found) {
      const name = args.name.trim();
      found.region.name = (name === "" ? "内容" : name).slice(0, 100);
    }
    return { kind: "region", boardId: args.boardId, regionId: args.regionId };
  });
}

/** 区块上移/下移：与相邻区块交换位置（B1）。 */
export function moveRegion(
  doc: CanvasDoc,
  args: { boardId: string; regionId: string; direction: "up" | "down" },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (!board) return null;
    const index = board.regions.findIndex((r) => r.id === args.regionId);
    if (index < 0) return null;
    const target = args.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= board.regions.length) {
      return { kind: "region", boardId: args.boardId, regionId: args.regionId };
    }
    const [region] = board.regions.splice(index, 1);
    board.regions.splice(target, 0, region);
    return { kind: "region", boardId: args.boardId, regionId: args.regionId };
  });
}

/** 深克隆区块并重建全部子对象 ID（region/section/column/block）。 */
function cloneRegionWithNewIds(region: CanvasRegion, newId: CanvasIdGenerator): CanvasRegion {
  const clone: CanvasRegion = structuredClone(region);
  clone.id = newId();
  for (const section of clone.sections) {
    section.id = newId();
    section.columns.forEach((column, i) => {
      column.id = newId();
      for (const block of column.blocks) block.id = newId();
      // columnWeights 与列数等长，无需重建
      void i;
    });
  }
  return clone;
}

/** 复制区块：插在原区块之后，全部子对象换新 ID，内容/样式逐字段保留（B1）。 */
export function duplicateRegion(
  doc: CanvasDoc,
  args: { boardId: string; regionId: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (!board) return null;
    const index = board.regions.findIndex((r) => r.id === args.regionId);
    if (index < 0) return null;
    const clone = cloneRegionWithNewIds(board.regions[index], newId);
    board.regions.splice(index + 1, 0, clone);
    return { kind: "region", boardId: args.boardId, regionId: clone.id };
  });
}

/** 删除区块：版面空了保留一个可输入空块（normalize 语义扩展到区块层，B1）。 */
export function deleteRegion(
  doc: CanvasDoc,
  args: { boardId: string; regionId: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (!board) return null;
    board.regions = board.regions.filter((r) => r.id !== args.regionId);
    normalizeBoardAfterDeletion(board, newId);
    return { kind: "board", boardId: args.boardId };
  });
}

/** 更新区块装饰样式（B1；undefined 值视为恢复默认，与 updateBlockStyle 一致）。 */
export function updateRegionStyle(
  doc: CanvasDoc,
  args: { boardId: string; regionId: string; style: Record<string, unknown> },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findRegion(draft, args.regionId);
    if (found) {
      found.region.style = { ...(found.region.style ?? {}), ...args.style };
      for (const [key, value] of Object.entries(found.region.style)) {
        if (value === undefined) delete (found.region.style as Record<string, unknown>)[key];
      }
      if (Object.keys(found.region.style).length === 0) found.region.style = undefined;
    }
    return { kind: "region", boardId: args.boardId, regionId: args.regionId };
  });
}

// ---------------------------------------------------------------------------
// 行 / 列 / 块（冻结交互 §3.2–§3.4；B1 起全部位于某个区块内）
// ---------------------------------------------------------------------------

/**
 * Enter / 「添加通栏」：在锚点行之后插入一个通栏行（单列，正文块），
 * 不跨出当前区块；已有后续行顺延；无论当前块位于第几列第几层，都插在整个行之后。
 */
export function insertSectionAfter(
  doc: CanvasDoc,
  args: { boardId: string; sectionId: string; text?: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findSection(draft, args.sectionId);
    if (!found || found.board.id !== args.boardId) return null;
    const column = createColumn([createTextBlock("body", args.text ?? "", newId)], newId);
    const section = createSection([column], newId);
    found.region.sections.splice(found.sectionIndex + 1, 0, section);
    return focusBlock(found.board, found.region, section.id, column.id, column.blocks[0], {
      caret: "end",
      edit: true,
    });
  });
}

/**
 * 左右加号：给当前行加一列（新列内含一个空正文块并聚焦）。
 * 不影响其他行的列数；权重插入「平均份额」，所有列重新分配宽度（规格 §3.3）。
 */
export function insertColumn(
  doc: CanvasDoc,
  args: { boardId: string; sectionId: string; columnId: string; side: "left" | "right" },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findSection(draft, args.sectionId);
    if (!found || found.board.id !== args.boardId) return null;
    const section = found.section;
    const index = section.columns.findIndex((c) => c.id === args.columnId);
    if (index < 0) return null;
    const insertAt = args.side === "left" ? index : index + 1;
    const column = createColumn([createTextBlock("body", "", newId)], newId);
    section.columns.splice(insertAt, 0, column);
    // 新列权重 = 现有权重均值 → 所有列按比例重分，版面总宽不变。
    const avg = section.columnWeights.length
      ? section.columnWeights.reduce((s, w) => s + w, 0) / section.columnWeights.length
      : 1;
    section.columnWeights.splice(insertAt, 0, avg);
    if (section.widthMode === "smart") section.widthMode = "manual"; // 多列不再受一文一图约束
    return focusBlock(found.board, found.region, section.id, column.id, column.blocks[0], {
      caret: "end",
      edit: true,
    });
  });
}

/** 模块底部加号：只在当前列、当前块之后插入新块（不创建通栏，规格 §3.4）。 */
export function insertBlockBelow(
  doc: CanvasDoc,
  args: { blockId: string; block?: CanvasBlock },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (!loc) return null;
    const block = args.block ?? createTextBlock("body", "", newId);
    loc.column.blocks.splice(loc.blockIndex + 1, 0, block);
    return focusBlock(loc.board, loc.region, loc.section.id, loc.column.id, block, {
      caret: "end",
      // 仅文本块需要聚焦编辑；图片块只选中不进入编辑态
      edit: block.type === "text",
    });
  });
}

/**
 * Enter 在文本中间：前半段留在原块，选区起点之后的文字（含选区）整体迁入
 * 当前区块内的新通栏首块（规格 §3.2，B1 起不跨区块）。不静默丢字。
 */
export function splitTextToSection(
  doc: CanvasDoc,
  args: { blockId: string; selectionStart: number; selectionEnd: number },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (!loc || loc.block.type !== "text") return null;
    const text = loc.block.text;
    const start = Math.max(0, Math.min(args.selectionStart, text.length));
    const head = text.slice(0, start);
    const tail = text.slice(start);
    loc.block.text = head;
    const column = createColumn([createTextBlock("body", tail, newId)], newId);
    const newSection = createSection([column], newId);
    loc.region.sections.splice(loc.sectionIndex + 1, 0, newSection);
    return focusBlock(loc.board, loc.region, newSection.id, column.id, column.blocks[0], {
      caret: "end",
      edit: true,
    });
  });
}

/**
 * 删除块：删空列 → 删空行 → 删空区块 → 版面保留可输入空块（规格 §6.1）。
 * 焦点回到相邻块（前一块优先，其次后一块/前一列）。
 */
export function deleteBlock(
  doc: CanvasDoc,
  args: { blockId: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (!loc) return null;
    const { board, section, column, blockIndex } = loc;
    const prev = column.blocks[blockIndex - 1];
    const nextBlk = column.blocks[blockIndex + 1];
    const prevColumn = section.columns[loc.columnIndex - 1];
    const nextColumn = section.columns[loc.columnIndex + 1];
    column.blocks.splice(blockIndex, 1);
    normalizeBoardAfterDeletion(board, newId);

    const target: CanvasBlock | undefined =
      prev ?? nextBlk ?? prevColumn?.blocks[prevColumn.blocks.length - 1] ?? nextColumn?.blocks[0];
    if (!target) return null;
    const t = findBlockLocation(draft, target.id);
    if (!t) return null;
    return focusBlock(t.board, t.region, t.section.id, t.column.id, t.block, {
      caret: "end",
      edit: t.block.type === "text" && (t.block as CanvasTextBlock).text === "",
    });
  });
}

/** 复制块：同列原位其后插入深克隆（新 ID），文本块进入编辑（B1 补齐块级能力）。 */
export function duplicateBlock(
  doc: CanvasDoc,
  args: { blockId: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (!loc) return null;
    const clone = structuredClone(loc.block) as CanvasBlock;
    clone.id = newId();
    loc.column.blocks.splice(loc.blockIndex + 1, 0, clone);
    return focusBlock(loc.board, loc.region, loc.section.id, loc.column.id, clone, {
      caret: "end",
      edit: clone.type === "text",
    });
  });
}

/** 块上移/下移：列内与相邻块交换位置（B1 补齐块级能力；越界为 no-op）。 */
export function moveBlock(
  doc: CanvasDoc,
  args: { blockId: string; direction: "up" | "down" },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (!loc) return null;
    const target = args.direction === "up" ? loc.blockIndex - 1 : loc.blockIndex + 1;
    if (target < 0 || target >= loc.column.blocks.length) {
      return focusBlock(loc.board, loc.region, loc.section.id, loc.column.id, loc.block);
    }
    const [block] = loc.column.blocks.splice(loc.blockIndex, 1);
    loc.column.blocks.splice(target, 0, block);
    return focusBlock(loc.board, loc.region, loc.section.id, loc.column.id, block);
  });
}

// ---------------------------------------------------------------------------
// 块内容与样式
// ---------------------------------------------------------------------------

export function updateTextBlock(
  doc: CanvasDoc,
  args: { blockId: string; text: string },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (loc && loc.block.type === "text") loc.block.text = args.text;
    return null;
  });
}

export function updateTextRole(
  doc: CanvasDoc,
  args: { blockId: string; role: CanvasTextRole },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (loc && loc.block.type === "text") {
      loc.block.role = args.role;
      // 角色切换重置字号/字重为角色默认（清掉显式覆盖）。
      if (loc.block.style) {
        delete loc.block.style.fontSize;
        delete loc.block.style.bold;
      }
    }
    return null;
  });
}

export function updateBlockStyle(
  doc: CanvasDoc,
  args: { blockId: string; style: Record<string, unknown> },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (loc) {
      loc.block.style = { ...(loc.block.style ?? {}), ...args.style };
      // undefined 值视为「恢复默认」。
      for (const [key, value] of Object.entries(loc.block.style)) {
        if (value === undefined) delete (loc.block.style as Record<string, unknown>)[key];
      }
      if (Object.keys(loc.block.style).length === 0) loc.block.style = undefined;
    }
    return null;
  });
}

export function setImageAsset(
  doc: CanvasDoc,
  args: { blockId: string; asset: CanvasImageAsset | null },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (loc && loc.block.type === "image") {
      loc.block.asset = args.asset;
    }
    return null;
  });
}

export function setImageFit(
  doc: CanvasDoc,
  args: { blockId: string; fit: "contain" | "cover" },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (loc && loc.block.type === "image") loc.block.fit = args.fit;
    return null;
  });
}

/** 图片块容器比例与说明文字（B2）；undefined = 保持原值。 */
export function updateImageBlock(
  doc: CanvasDoc,
  args: { blockId: string; ratio?: CanvasImageRatio; alt?: string },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (loc && loc.block.type === "image") {
      if (args.ratio !== undefined) loc.block.ratio = args.ratio;
      if (args.alt !== undefined) loc.block.alt = args.alt;
    }
    return null;
  });
}

/** 行动按钮属性更新（B2）；undefined = 保持原值。href 不做安全校验
 * （校验在输入边界与 validation 层；渲染层另有 isSafeButtonHref 兜底）。 */
export function updateButtonBlock(
  doc: CanvasDoc,
  args: {
    blockId: string;
    label?: string;
    href?: string;
    align?: CanvasTextAlign;
    variant?: CanvasButtonVariant;
  },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const loc = findBlockLocation(draft, args.blockId);
    if (loc && loc.block.type === "button") {
      if (args.label !== undefined) loc.block.label = args.label.slice(0, 200);
      if (args.href !== undefined) loc.block.href = args.href.slice(0, 2048);
      if (args.align !== undefined) loc.block.align = args.align;
      if (args.variant !== undefined) loc.block.variant = args.variant;
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// 统一插入目标（B2）：所有添加入口经 resolveInsertTarget 解析后走 insertBlockAtTarget
// ---------------------------------------------------------------------------

/**
 * 统一块插入（B2）：按 resolveInsertTarget 的解析结果落块。
 * - column：afterBlockId 存在 → 插在该块之后；否则追加到该列末尾；
 * - region-end：在区块末尾追加一行（首列放块）；区块缺行/缺失时自动建行/建区块；
 * - create:"page" 由调用方先建页面再二次解析（命令层不隐式建页面）。
 * 文本块聚焦编辑；其余块只选中。
 */
export function insertBlockAtTarget(
  doc: CanvasDoc,
  target:
    | { kind: "column"; boardId: string; regionId: string; sectionId: string; columnId: string; afterBlockId?: string }
    | { kind: "region-end"; boardId: string; regionId: string },
  block: CanvasBlock,
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, target.boardId);
    if (!board) return null;
    let region = board.regions.find((r) => r.id === target.regionId) ?? null;
    if (!region) {
      region = createRegion([], newId);
      board.regions.push(region);
    }
    if (target.kind === "region-end") {
      const column = createColumn([block], newId);
      const section = createSection([column], newId);
      region.sections.push(section);
      return focusBlock(board, region, section.id, column.id, block, {
        caret: "end",
        edit: block.type === "text",
      });
    }
    const section = region.sections.find((s) => s.id === target.sectionId);
    const column = section?.columns.find((c) => c.id === target.columnId);
    if (!section || !column) {
      // 锚点行/列已被删：兜底追加到区块末尾（调用方正常会重新解析目标，
      // 这里保证命令自身对过期 target 也不丢块）
      const newColumn = createColumn([block], newId);
      const newSection = createSection([newColumn], newId);
      region.sections.push(newSection);
      return focusBlock(board, region, newSection.id, newColumn.id, block, {
        caret: "end",
        edit: block.type === "text",
      });
    }
    if (target.afterBlockId) {
      const index = column.blocks.findIndex((b) => b.id === target.afterBlockId);
      if (index >= 0) {
        column.blocks.splice(index + 1, 0, block);
      } else {
        column.blocks.push(block);
      }
    } else {
      column.blocks.push(block);
    }
    return focusBlock(board, region, section.id, column.id, block, {
      caret: "end",
      edit: block.type === "text",
    });
  });
}

/**
 * 区块间隙「＋」：在指定区块之后插入新区块（含一个可输入空正文行）。
 * regionId 缺省 = 追加到页面末尾。聚焦新区块首块并进入编辑。
 */
export function insertRegionAfter(
  doc: CanvasDoc,
  args: { boardId: string; regionId?: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (!board) return null;
    const column = createColumn([createTextBlock("body", "", newId)], newId);
    const region = createRegion([createSection([column], newId)], newId);
    const index = args.regionId ? board.regions.findIndex((r) => r.id === args.regionId) : -1;
    if (index >= 0) board.regions.splice(index + 1, 0, region);
    else board.regions.push(region);
    return focusBlock(board, region, region.sections[0].id, column.id, column.blocks[0], {
      caret: "end",
      edit: true,
    });
  });
}

/**
 * 减列（B2 属性栏）：仅允许删除空列（无任何块）；非空列为 no-op
 * （避免块被静默删除）。删除后权重同步收缩并归一 equal；版面至少保留一列。
 */
export function removeColumn(
  doc: CanvasDoc,
  args: { boardId: string; sectionId: string; columnId: string },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findSection(draft, args.sectionId);
    if (!found || found.board.id !== args.boardId) return null;
    const section = found.section;
    if (section.columns.length <= 1) return null;
    const index = section.columns.findIndex((c) => c.id === args.columnId);
    if (index < 0) return null;
    if (section.columns[index].blocks.length > 0) return null;
    section.columns.splice(index, 1);
    section.columnWeights.splice(index, 1);
    if (section.columnWeights.length === 0) section.columnWeights = [1];
    if (section.widthMode === "smart") section.widthMode = "equal";
    return null;
  });
}

/** 行级布局覆盖（B2）：行内间距 gap / 垂直对齐 verticalAlign；undefined = 保持。 */
export function updateSectionLayout(
  doc: CanvasDoc,
  args: {
    boardId: string;
    sectionId: string;
    gap?: number;
    verticalAlign?: CanvasSectionVerticalAlign;
  },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findSection(draft, args.sectionId);
    if (!found || found.board.id !== args.boardId) return null;
    if (args.gap !== undefined) found.section.gap = Math.min(128, Math.max(0, Math.round(args.gap)));
    if (args.verticalAlign !== undefined) found.section.verticalAlign = args.verticalAlign;
    return null;
  });
}

/** 直接设定列权重（B2 属性栏自定义滑杆）：写 manual 权重数组（恒与列等长、正数）。 */
export function setColumnWeights(
  doc: CanvasDoc,
  args: { boardId: string; sectionId: string; weights: number[] },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findSection(draft, args.sectionId);
    if (!found || found.board.id !== args.boardId) return null;
    const section = found.section;
    if (args.weights.length !== section.columns.length) return null;
    if (!args.weights.every((w) => Number.isFinite(w) && w > 0)) return null;
    section.columnWeights = [...args.weights];
    section.widthMode = "manual";
    return null;
  });
}

/** 页面内边距（B2 属性栏）。 */
export function updateBoardPadding(
  doc: CanvasDoc,
  args: { boardId: string; padding: number },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (board) board.padding = Math.min(128, Math.max(0, Math.round(args.padding)));
    return { kind: "board", boardId: args.boardId };
  });
}

// ---------------------------------------------------------------------------
// 列宽策略（规格 §4.2：拖动后 manual，可恢复智能/等分）
// ---------------------------------------------------------------------------

export function setSectionWidthMode(
  doc: CanvasDoc,
  args: { boardId: string; sectionId: string; mode: CanvasSectionWidthMode },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findSection(draft, args.sectionId);
    if (found) {
      found.section.widthMode = args.mode;
      if (args.mode === "equal") {
        found.section.columnWeights = found.section.columns.map(() => 1);
      }
    }
    return null;
  });
}

/** 拖列分隔线提交：两列相邻像素宽 → manual 权重（本行独立，不影响标题）。 */
export function applyColumnDrag(
  doc: CanvasDoc,
  args: {
    boardId: string;
    sectionId: string;
    boundaryIndex: number;
    newLeftWidth: number;
    currentWidths: number[];
  },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findSection(draft, args.sectionId);
    if (!found) return null;
    const next = manualWeightsFromDrag(args.currentWidths, args.boundaryIndex, args.newLeftWidth);
    found.section.columnWeights = next;
    found.section.widthMode = "manual";
    return null;
  });
}

/** 智能比例计算结果提交（UI 在图片加载/版面宽变/文本编辑结束等触发点调用）。
 *  manual 行不生效——手调比例不被自动重算覆盖（规格 §4.2）。 */
export function applySmartWeights(
  doc: CanvasDoc,
  args: { boardId: string; sectionId: string; weights: [number, number] },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const found = findSection(draft, args.sectionId);
    if (found && found.section.columns.length === 2 && found.section.widthMode !== "manual") {
      found.section.columnWeights = [...args.weights];
      found.section.widthMode = "smart";
    }
    return null;
  });
}

// ---------------------------------------------------------------------------
// 自由容器（规格 §3.5）
// ---------------------------------------------------------------------------

export function createFreeText(
  doc: CanvasDoc,
  args: { x: number; y: number; width?: number },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const item: CanvasFreeItem = {
      id: newId(),
      x: args.x,
      y: args.y,
      width: args.width ?? 240,
      zIndex: nextZIndex(draft),
      block: createTextBlock("body", "", newId),
    };
    draft.freeItems.push(item);
    return { kind: "free", itemId: item.id };
  });
}

export function createFreeImage(
  doc: CanvasDoc,
  args: { x: number; y: number; width?: number; asset?: CanvasImageAsset | null },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const item: CanvasFreeItem = {
      id: newId(),
      x: args.x,
      y: args.y,
      width: args.width ?? 320,
      zIndex: nextZIndex(draft),
      block: createImageBlock(args.asset ?? null, newId),
    };
    draft.freeItems.push(item);
    return { kind: "free", itemId: item.id };
  });
}

export function updateFreeItem(
  doc: CanvasDoc,
  args: { itemId: string; x?: number; y?: number; width?: number; zIndex?: number },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const item = findFreeItem(draft, args.itemId);
    if (item) {
      if (args.x !== undefined) item.x = args.x;
      if (args.y !== undefined) item.y = args.y;
      if (args.width !== undefined) item.width = Math.max(80, args.width);
      if (args.zIndex !== undefined) item.zIndex = args.zIndex;
    }
    return { kind: "free", itemId: args.itemId };
  });
}

export function updateFreeItemBlock(
  doc: CanvasDoc,
  args: {
    itemId: string;
    text?: string;
    asset?: CanvasImageAsset | null;
    fit?: "contain" | "cover";
    ratio?: CanvasImageRatio;
    role?: CanvasTextRole;
    style?: Record<string, unknown>;
  },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const item = findFreeItem(draft, args.itemId);
    if (!item) return null;
    if (args.text !== undefined && item.block.type === "text") item.block.text = args.text;
    if (args.asset !== undefined && item.block.type === "image") item.block.asset = args.asset;
    if (args.fit !== undefined && item.block.type === "image") item.block.fit = args.fit;
    if (args.ratio !== undefined && item.block.type === "image") item.block.ratio = args.ratio;
    if (args.role !== undefined && item.block.type === "text") {
      item.block.role = args.role;
      // 角色切换重置字号/字重为角色默认（清掉显式覆盖），与 updateTextRole 一致。
      if (item.block.style) {
        delete item.block.style.fontSize;
        delete item.block.style.bold;
      }
    }
    if (args.style) {
      item.block.style = { ...(item.block.style ?? {}), ...args.style };
    }
    return { kind: "free", itemId: args.itemId };
  });
}

export function deleteFreeItem(doc: CanvasDoc, args: { itemId: string }): CanvasCommandResult {
  return edit(doc, (draft) => {
    draft.freeItems = draft.freeItems.filter((f) => f.id !== args.itemId);
    return null;
  });
}

/**
 * 自由对象移入区块（B1）：块内容迁入目标区块——给了 sectionId+columnId 则追加到
 * 该列末尾；只给 sectionId 则在该行加一列；都不给则区块末尾新建一行。
 * 自由对象从 freeItems 移除；整个操作一个命令、进历史可撤销。
 */
export function attachFreeItemToRegion(
  doc: CanvasDoc,
  args: {
    freeItemId: string;
    boardId: string;
    regionId: string;
    sectionId?: string;
    columnId?: string;
  },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const item = findFreeItem(draft, args.freeItemId);
    const board = findBoard(draft, args.boardId);
    const region = board?.regions.find((r) => r.id === args.regionId);
    if (!item || !board || !region) return null;
    const block = structuredClone(item.block) as CanvasBlock;
    draft.freeItems = draft.freeItems.filter((f) => f.id !== args.freeItemId);

    let sectionId: string;
    let columnId: string;
    if (args.sectionId) {
      const section = region.sections.find((s) => s.id === args.sectionId);
      if (!section) return null;
      if (args.columnId) {
        const column = section.columns.find((c) => c.id === args.columnId);
        if (!column) return null;
        column.blocks.push(block);
        sectionId = section.id;
        columnId = column.id;
      } else {
        const column = createColumn([block], newId);
        section.columns.push(column);
        const avg = section.columnWeights.length
          ? section.columnWeights.reduce((s, w) => s + w, 0) / section.columnWeights.length
          : 1;
        section.columnWeights.push(avg);
        if (section.widthMode === "smart") section.widthMode = "manual";
        sectionId = section.id;
        columnId = column.id;
      }
    } else {
      const column = createColumn([block], newId);
      const section = createSection([column], newId);
      region.sections.push(section);
      sectionId = section.id;
      columnId = column.id;
    }
    return focusBlock(board, region, sectionId, columnId, block);
  });
}

/** 模板类型（B1 左侧「模板」面板四项）。 */
export type CanvasTemplateKind = "blank-structure" | "image-text" | "three-columns" | "cta";

/** 模板占位提示文字（用户可编辑/替换）。 */
const TEMPLATE_PLACEHOLDER_TITLE = "点击输入标题";
const TEMPLATE_PLACEHOLDER_BODY = "点击输入正文";
const TEMPLATE_PLACEHOLDER_CTA = "点击输入行动号召文字";

/**
 * 把模板作为新区块追加到指定页面末尾（B1）：
 * - blank-structure：一个空正文块；
 * - image-text：双列（左文右图占位）；
 * - three-columns：三列，各一标题 + 正文；
 * - cta：居中单文本块。
 * 占位块全部为提示文字；插入后选中新区块。
 */
export function applyCanvasTemplate(
  doc: CanvasDoc,
  args: { boardId: string; template: CanvasTemplateKind; name?: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    if (!board) return null;
    const text = (role: CanvasTextRole, t: string, style?: Record<string, unknown>) => {
      const block = createTextBlock(role, t, newId);
      if (style) block.style = style as CanvasTextBlock["style"];
      return block;
    };
    let region: CanvasRegion;
    switch (args.template) {
      case "blank-structure":
        region = createRegion(
          [createSection([createColumn([text("body", "")], newId)], newId)],
          newId,
          args.name ?? "空白结构",
        );
        break;
      case "image-text":
        region = createRegion(
          [
            createSection(
              [
                createColumn([text("body", TEMPLATE_PLACEHOLDER_BODY)], newId),
                createColumn([createImageBlock(null, newId)], newId),
              ],
              newId,
            ),
          ],
          newId,
          args.name ?? "图文介绍",
        );
        break;
      case "three-columns":
        region = createRegion(
          [
            createSection(
              [
                createColumn(
                  [text("title", TEMPLATE_PLACEHOLDER_TITLE), text("body", TEMPLATE_PLACEHOLDER_BODY)],
                  newId,
                ),
                createColumn(
                  [text("title", TEMPLATE_PLACEHOLDER_TITLE), text("body", TEMPLATE_PLACEHOLDER_BODY)],
                  newId,
                ),
                createColumn(
                  [text("title", TEMPLATE_PLACEHOLDER_TITLE), text("body", TEMPLATE_PLACEHOLDER_BODY)],
                  newId,
                ),
              ],
              newId,
            ),
          ],
          newId,
          args.name ?? "三列卖点",
        );
        break;
      case "cta":
        region = createRegion(
          [
            createSection(
              [createColumn([text("body", TEMPLATE_PLACEHOLDER_CTA, { align: "center" })], newId)],
              newId,
            ),
          ],
          newId,
          args.name ?? "行动区",
        );
        break;
    }
    board.regions.push(region);
    return { kind: "region", boardId: board.id, regionId: region.id };
  });
}

function nextZIndex(doc: CanvasDoc): number {
  return doc.freeItems.reduce((max, f) => Math.max(max, f.zIndex), 0) + 1;
}

// ---------------------------------------------------------------------------
// 查询辅助（只读）
// ---------------------------------------------------------------------------

export function getBlock(doc: CanvasDoc, blockId: string): CanvasBlock | null {
  return findBlockLocation(doc, blockId)?.block ?? null;
}

export function getImageBlock(doc: CanvasDoc, blockId: string): CanvasImageBlock | null {
  const block = getBlock(doc, blockId);
  return block && block.type === "image" ? block : null;
}

export function getTextBlock(doc: CanvasDoc, blockId: string): CanvasTextBlock | null {
  const block = getBlock(doc, blockId);
  return block && block.type === "text" ? block : null;
}

export { BOARD_DEFAULT_WIDTH, BOARD_MIN_WIDTH, BOARD_MAX_WIDTH };
