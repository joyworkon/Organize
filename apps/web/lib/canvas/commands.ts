/**
 * 构思画布结构命令（docs/idea-canvas-plan.md §6.1）。
 *
 * 全部为纯函数：(doc, args) → { doc, focus }。不触碰 DOM、不发请求、
 * 不进入 setState 更新器——保存与上传由 UI 层在事件处理器中执行。
 * 同一操作就是一个可撤销事务（历史由 components/canvas 的 store 记录）。
 */

import {
  BOARD_DEFAULT_WIDTH,
  BOARD_MAX_WIDTH,
  BOARD_MIN_WIDTH,
  CANVAS_SCHEMA_VERSION,
  CanvasBlock,
  CanvasBoard,
  CanvasCommandResult,
  CanvasDoc,
  CanvasFocus,
  CanvasFreeItem,
  CanvasIdGenerator,
  CanvasImageAsset,
  CanvasImageBlock,
  CanvasSectionWidthMode,
  CanvasTextBlock,
  CanvasTextRole,
  defaultIdGenerator,
  createBoardShape,
  createColumn,
  createImageBlock,
  createSection,
  createTextBlock,
  findBlockLocation,
  findBoard,
  findFreeItem,
  findSection,
  normalizeBoardAfterDeletion,
} from "./model";
import { manualWeightsFromDrag } from "./layout";

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

// ---------------------------------------------------------------------------
// 版面
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
    const title = board.sections[0].columns[0].blocks[0] as CanvasTextBlock;
    return {
      kind: "block",
      boardId: board.id,
      sectionId: board.sections[0].id,
      columnId: board.sections[0].columns[0].id,
      blockId: title.id,
      caret: "end",
      edit: true,
    } satisfies CanvasFocus;
  });
}

/** 工具栏「新建版面」：放在默认网格位（避开已有版面）。 */
export function createBoardAutoPlace(
  doc: CanvasDoc,
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  const step = BOARD_DEFAULT_WIDTH + 80;
  const occupied = new Set(doc.boards.map((b) => `${Math.round(b.x)},${Math.round(b.y)}`));
  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const col = attempt % 4;
    const row = Math.floor(attempt / 4);
    x = col * step;
    y = row * (step + 60);
    if (!occupied.has(`${x},${y}`)) break;
  }
  return createBoard(doc, { x, y }, newId);
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

export function deleteBoard(doc: CanvasDoc, args: { boardId: string }): CanvasCommandResult {
  return edit(doc, (draft) => {
    draft.boards = draft.boards.filter((b) => b.id !== args.boardId);
    return null;
  });
}

// ---------------------------------------------------------------------------
// 分区 / 列 / 块（冻结交互 §3.2–§3.4）
// ---------------------------------------------------------------------------

/**
 * Enter / 「添加通栏」：在锚点分区之后插入一个通栏分区（单列，正文块）。
 * 已有后续分区顺延；无论当前块位于第几列第几层，都插在整个分区之后。
 */
export function insertSectionAfter(
  doc: CanvasDoc,
  args: { boardId: string; sectionId: string; text?: string },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    const found = board ? findSection(draft, args.sectionId) : null;
    if (!board || !found) return null;
    const column = createColumn([createTextBlock("body", args.text ?? "", newId)], newId);
    const section = createSection([column], newId);
    board.sections.splice(found.sectionIndex + 1, 0, section);
    const block = column.blocks[0];
    return {
      kind: "block",
      boardId: board.id,
      sectionId: section.id,
      columnId: column.id,
      blockId: block.id,
      caret: "end",
      edit: true,
    } satisfies CanvasFocus;
  });
}

/**
 * 左右加号：给当前分区加一列（新列内含一个空正文块并聚焦）。
 * 不影响其他分区的列数；权重插入「平均份额」，所有列重新分配宽度（规格 §3.3）。
 */
export function insertColumn(
  doc: CanvasDoc,
  args: { boardId: string; sectionId: string; columnId: string; side: "left" | "right" },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const board = findBoard(draft, args.boardId);
    const found = board ? findSection(draft, args.sectionId) : null;
    if (!board || !found) return null;
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
    const block = column.blocks[0];
    return {
      kind: "block",
      boardId: board.id,
      sectionId: section.id,
      columnId: column.id,
      blockId: block.id,
      caret: "end",
      edit: true,
    } satisfies CanvasFocus;
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
    return {
      kind: "block",
      boardId: loc.board.id,
      sectionId: loc.section.id,
      columnId: loc.column.id,
      blockId: block.id,
      caret: "end",
      edit: true,
    } satisfies CanvasFocus;
  });
}

/**
 * Enter 在文本中间：前半段留在原块，选区起点之后的文字（含选区）整体迁入
 * 新通栏首块（规格 §3.2）。不静默丢字。
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
    const board = draft.boards.find((b) => b.id === loc.board.id);
    const section = board?.sections.find((s) => s.id === loc.section.id);
    if (!board || !section) return null;
    const column = createColumn([createTextBlock("body", tail, newId)], newId);
    const newSection = createSection([column], newId);
    board.sections.splice(loc.sectionIndex + 1, 0, newSection);
    const block = column.blocks[0];
    return {
      kind: "block",
      boardId: board.id,
      sectionId: newSection.id,
      columnId: column.id,
      blockId: block.id,
      caret: "end",
      edit: true,
    } satisfies CanvasFocus;
  });
}

/**
 * 删除块：删空列 → 删空分区 → 版面保留可输入空块（规格 §6.1）。
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
    return {
      kind: "block",
      boardId: t.board.id,
      sectionId: t.section.id,
      columnId: t.column.id,
      blockId: t.block.id,
      caret: "end",
      edit: t.block.type === "text" && (t.block as CanvasTextBlock).text === "",
    } satisfies CanvasFocus;
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

/** 拖列分隔线提交：两列相邻像素宽 → manual 权重（本分区独立，不影响标题）。 */
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
 *  manual 分区不生效——手调比例不被自动重算覆盖（规格 §4.2）。 */
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
    style?: Record<string, unknown>;
  },
): CanvasCommandResult {
  return edit(doc, (draft) => {
    const item = findFreeItem(draft, args.itemId);
    if (!item) return null;
    if (args.text !== undefined && item.block.type === "text") item.block.text = args.text;
    if (args.asset !== undefined && item.block.type === "image") item.block.asset = args.asset;
    if (args.fit !== undefined && item.block.type === "image") item.block.fit = args.fit;
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
