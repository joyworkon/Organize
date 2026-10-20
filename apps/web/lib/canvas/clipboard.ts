/**
 * 构思画布内部剪贴板（纯函数 + 标签页内存）。
 *
 * 复制只深拷贝选区，不改文档。粘贴一次产出整份新文档（新 id），
 * 超上限时整批拒绝并返回原 doc 引用。系统剪贴板只是额外的纯文本副本。
 */

import {
  CANVAS_SCHEMA_VERSION,
  type CanvasBlock,
  type CanvasCommandResult,
  type CanvasDoc,
  type CanvasFreeItem,
  type CanvasIdGenerator,
  type CanvasRegion,
  defaultIdGenerator,
  findBlockLocation,
  findRegion,
} from "./model";
import {
  FREE_ITEM_DUPLICATE_OFFSET,
  createFreeText,
  insertBlockAtTarget,
  updateFreeItemBlock,
} from "./commands";
import type { ExplicitInsertPosition, InsertSelection } from "./insert-target";
import { CANVAS_LIMITS } from "./validation";

export type CanvasClipboardPayload =
  | { kind: "free"; items: CanvasFreeItem[]; plainText: string }
  | { kind: "blocks"; blocks: CanvasBlock[]; plainText: string }
  | { kind: "region"; sourceBoardId: string; region: CanvasRegion; plainText: string };

export interface CanvasPasteTarget {
  /** 指针在视口内时的世界坐标；未知或不在视口内为 null。 */
  pointer: { x: number; y: number } | null;
  /** 同一份载荷已经成功粘贴的次数，用来错开连续落点。 */
  pasteIndex: number;
  selection: InsertSelection;
  /** 指针命中的列/区块；空白处为 null。 */
  explicit: ExplicitInsertPosition | null;
}

export interface CanvasClipboardPasteResult extends CanvasCommandResult {
  blockIds?: string[];
  itemIds?: string[];
  /** 整批拒绝时的说明；doc 仍是入参引用。 */
  rejected?: string;
}

const LIMIT_FREE = `自由元素已达 ${CANVAS_LIMITS.maxFreeItems} 个上限，这次没有粘贴`;
const LIMIT_COLUMN = `这一列已达 ${CANVAS_LIMITS.maxBlocksPerColumn} 个模块上限，这次没有粘贴`;
const LIMIT_BLOCKS = `模块已达 ${CANVAS_LIMITS.maxBlocks} 个上限，这次没有粘贴`;
const LIMIT_REGIONS = `这个版面的区块已达 ${CANVAS_LIMITS.maxRegionsPerBoard} 个上限，这次没有粘贴`;
const NO_PLACE = "没有可放置的版面，这次没有粘贴";

export function copyCanvasSelection(doc: CanvasDoc, selection: InsertSelection): CanvasClipboardPayload | null {
  if (!selection || selection.kind === "board") return null;
  if (selection.kind === "free" || selection.kind === "frees") {
    const wanted = new Set(selection.kind === "free" ? [selection.itemId] : selection.itemIds);
    const items = doc.freeItems
      .filter((item) => wanted.has(item.id))
      .sort((a, b) => a.zIndex - b.zIndex || doc.freeItems.indexOf(a) - doc.freeItems.indexOf(b))
      .map((item) => structuredClone(item));
    if (items.length === 0) return null;
    return { kind: "free", items, plainText: plainTextFromBlocks(items.map((item) => item.block)) };
  }
  if (selection.kind === "region") {
    const found = findRegion(doc, selection.regionId);
    if (!found || found.board.id !== selection.boardId) return null;
    const region = structuredClone(found.region);
    return {
      kind: "region",
      sourceBoardId: found.board.id,
      region,
      plainText: plainTextFromBlocks(blocksInRegion(region)),
    };
  }
  const wanted = new Set(selection.kind === "block" ? [selection.blockId] : selection.blockIds);
  const blocks: CanvasBlock[] = [];
  for (const board of doc.boards) {
    for (const region of board.regions) {
      for (const block of blocksInRegion(region)) {
        if (wanted.has(block.id)) blocks.push(structuredClone(block));
      }
    }
  }
  if (blocks.length === 0) return null;
  return { kind: "blocks", blocks, plainText: plainTextFromBlocks(blocks) };
}

export function pasteCanvasClipboard(
  doc: CanvasDoc,
  payload: CanvasClipboardPayload,
  target: CanvasPasteTarget,
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasClipboardPasteResult {
  if (payload.kind === "free") return pasteFreeItems(doc, payload.items, target, newId);
  if (payload.kind === "region") return pasteRegion(doc, payload, target, newId);
  return pasteBlocks(doc, payload.blocks, target, newId);
}

/** 系统剪贴板里的纯文本，落成一个自由文本。 */
export function pastePlainTextAsFreeItem(
  doc: CanvasDoc,
  text: string,
  pointer: { x: number; y: number } | null,
  pasteIndex: number,
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasClipboardPasteResult {
  const clipped = text.slice(0, CANVAS_LIMITS.maxTextLength);
  if (!clipped.trim()) return { doc };
  if (doc.freeItems.length >= CANVAS_LIMITS.maxFreeItems) return { doc, rejected: LIMIT_FREE };
  const origin = pointer ?? { x: 40, y: 40 };
  const at = {
    x: origin.x + pasteIndex * FREE_ITEM_DUPLICATE_OFFSET,
    y: origin.y + pasteIndex * FREE_ITEM_DUPLICATE_OFFSET,
  };
  const created = createFreeText(doc, at, newId);
  const itemId = created.focus?.kind === "free" ? created.focus.itemId : "";
  if (!itemId) return { doc, rejected: LIMIT_FREE };
  const updated = updateFreeItemBlock(created.doc, { itemId, text: clipped });
  return { doc: updated.doc, focus: { kind: "free", itemId, edit: false }, itemIds: [itemId] };
}

function pasteFreeItems(
  doc: CanvasDoc,
  items: readonly CanvasFreeItem[],
  target: CanvasPasteTarget,
  newId: CanvasIdGenerator,
): CanvasClipboardPasteResult {
  if (items.length === 0) return { doc };
  if (doc.freeItems.length + items.length > CANVAS_LIMITS.maxFreeItems) return { doc, rejected: LIMIT_FREE };
  const origin = {
    x: Math.min(...items.map((item) => item.x)),
    y: Math.min(...items.map((item) => item.y)),
  };
  const shift = target.pointer
    ? target.pasteIndex * FREE_ITEM_DUPLICATE_OFFSET
    : (target.pasteIndex + 1) * FREE_ITEM_DUPLICATE_OFFSET;
  const anchor = target.pointer
    ? { x: target.pointer.x + shift, y: target.pointer.y + shift }
    : { x: origin.x + shift, y: origin.y + shift };
  const draft = cloneDoc(doc);
  let z = nextZIndex(draft);
  const itemIds: string[] = [];
  for (const item of items) {
    const clone = structuredClone(item);
    clone.id = newId();
    clone.block.id = newId();
    clone.x = anchor.x + (item.x - origin.x);
    clone.y = anchor.y + (item.y - origin.y);
    clone.zIndex = z;
    z += 1;
    draft.freeItems.push(clone);
    itemIds.push(clone.id);
  }
  return {
    doc: draft,
    focus: itemIds.length === 1
      ? { kind: "free", itemId: itemIds[0], edit: false }
      : { kind: "frees", itemIds },
    itemIds,
  };
}

function pasteBlocks(
  doc: CanvasDoc,
  blocks: readonly CanvasBlock[],
  target: CanvasPasteTarget,
  newId: CanvasIdGenerator,
): CanvasClipboardPasteResult {
  if (blocks.length === 0) return { doc };
  const clones = blocks.map((block) => {
    const clone = structuredClone(block);
    clone.id = newId();
    return clone;
  });
  const selected = target.selection?.kind === "block"
    ? findBlockLocation(doc, target.selection.blockId)
    : null;
  if (selected) {
    if (overBlockLimit(doc, clones.length)) return { doc, rejected: LIMIT_BLOCKS };
    if (selected.column.blocks.length + clones.length > CANVAS_LIMITS.maxBlocksPerColumn) {
      return { doc, rejected: LIMIT_COLUMN };
    }
    return insertBlocksInColumn(doc, clones, {
      kind: "column",
      boardId: selected.board.id,
      regionId: selected.region.id,
      sectionId: selected.section.id,
      columnId: selected.column.id,
      afterBlockId: selected.block.id,
    }, newId);
  }
  if (target.explicit) {
    if (overBlockLimit(doc, clones.length)) return { doc, rejected: LIMIT_BLOCKS };
    if (target.explicit.kind === "column") {
      const length = columnLength(doc, target.explicit.columnId);
      if (length === null) return { doc, rejected: NO_PLACE };
      if (length + clones.length > CANVAS_LIMITS.maxBlocksPerColumn) return { doc, rejected: LIMIT_COLUMN };
    } else {
      const found = findRegion(doc, target.explicit.regionId);
      if (!found || found.board.id !== target.explicit.boardId) return { doc, rejected: NO_PLACE };
    }
    return insertBlocksInColumn(doc, clones, target.explicit, newId);
  }
  if (clones.every(isFreeConvertible)) {
    if (doc.freeItems.length + clones.length > CANVAS_LIMITS.maxFreeItems) return { doc, rejected: LIMIT_FREE };
    return blocksAsFreeItems(doc, clones, target, newId);
  }
  const board = doc.boards[0];
  const region = board?.regions[board.regions.length - 1];
  if (!board || !region) return { doc, rejected: NO_PLACE };
  if (overBlockLimit(doc, clones.length)) return { doc, rejected: LIMIT_BLOCKS };
  return insertBlocksInColumn(doc, clones, { kind: "region-end", boardId: board.id, regionId: region.id }, newId);
}

function pasteRegion(
  doc: CanvasDoc,
  payload: Extract<CanvasClipboardPayload, { kind: "region" }>,
  target: CanvasPasteTarget,
  newId: CanvasIdGenerator,
): CanvasClipboardPasteResult {
  const added = blocksInRegion(payload.region).length;
  if (overBlockLimit(doc, added)) return { doc, rejected: LIMIT_BLOCKS };
  let boardId: string | null = null;
  let insertAt = -1;
  if (target.selection?.kind === "region") {
    const selected = target.selection;
    const board = doc.boards.find((entry) => entry.id === selected.boardId);
    const index = board?.regions.findIndex((region) => region.id === selected.regionId) ?? -1;
    if (board && index >= 0) {
      boardId = board.id;
      insertAt = index + 1;
    }
  }
  if (!boardId) {
    const board = doc.boards.find((entry) => entry.id === payload.sourceBoardId);
    const index = board?.regions.findIndex((region) => region.id === payload.region.id) ?? -1;
    if (board && index >= 0) {
      boardId = board.id;
      insertAt = index + 1;
    } else if (board) {
      boardId = board.id;
      insertAt = board.regions.length;
    }
  }
  if (!boardId) {
    const selected = target.selection;
    const selectedBoard = selected?.kind === "board"
      ? doc.boards.find((entry) => entry.id === selected.boardId)
      : null;
    const fallback = selectedBoard ?? doc.boards[0];
    if (!fallback) return { doc, rejected: NO_PLACE };
    boardId = fallback.id;
    insertAt = fallback.regions.length;
  }
  const board = doc.boards.find((entry) => entry.id === boardId);
  if (!board) return { doc, rejected: NO_PLACE };
  if (board.regions.length >= CANVAS_LIMITS.maxRegionsPerBoard) return { doc, rejected: LIMIT_REGIONS };
  const clone = cloneRegionWithNewIds(payload.region, newId);
  const draft = cloneDoc(doc);
  const draftBoard = draft.boards.find((entry) => entry.id === boardId);
  if (!draftBoard) return { doc, rejected: NO_PLACE };
  draftBoard.regions.splice(insertAt, 0, clone);
  return {
    doc: draft,
    focus: { kind: "region", boardId, regionId: clone.id },
  };
}

function insertBlocksInColumn(
  doc: CanvasDoc,
  blocks: readonly CanvasBlock[],
  target: ExplicitInsertPosition,
  newId: CanvasIdGenerator,
): CanvasClipboardPasteResult {
  let next = doc;
  let after = target.kind === "column" ? target.afterBlockId : undefined;
  let focus: CanvasCommandResult["focus"];
  const blockIds: string[] = [];
  for (const block of blocks) {
    const placed = target.kind === "column"
      ? insertBlockAtTarget(next, { ...target, afterBlockId: after }, block, newId)
      : insertBlockAtTarget(next, target, block, newId);
    if (!findBlockLocation(placed.doc, block.id)) return { doc, rejected: NO_PLACE };
    next = placed.doc;
    after = block.id;
    blockIds.push(block.id);
    focus = placed.focus?.kind === "block" ? { ...placed.focus, edit: false } : placed.focus;
  }
  return {
    doc: next,
    focus: blockIds.length === 1 ? focus : undefined,
    blockIds,
  };
}

function blocksAsFreeItems(
  doc: CanvasDoc,
  blocks: readonly CanvasBlock[],
  target: CanvasPasteTarget,
  newId: CanvasIdGenerator,
): CanvasClipboardPasteResult {
  const shift = target.pointer
    ? target.pasteIndex * FREE_ITEM_DUPLICATE_OFFSET
    : (target.pasteIndex + 1) * FREE_ITEM_DUPLICATE_OFFSET;
  const anchor = target.pointer
    ? { x: target.pointer.x + shift, y: target.pointer.y + shift }
    : { x: 40 + shift, y: 40 + shift };
  const draft = cloneDoc(doc);
  let z = nextZIndex(draft);
  const itemIds: string[] = [];
  blocks.forEach((block, index) => {
    if (block.type !== "text" && block.type !== "image") return;
    const item: CanvasFreeItem = {
      id: newId(),
      x: anchor.x,
      y: anchor.y + index * FREE_ITEM_DUPLICATE_OFFSET,
      width: block.type === "image" ? 320 : 240,
      zIndex: z,
      block,
    };
    z += 1;
    draft.freeItems.push(item);
    itemIds.push(item.id);
  });
  if (itemIds.length === 0) return { doc, rejected: NO_PLACE };
  return {
    doc: draft,
    focus: itemIds.length === 1
      ? { kind: "free", itemId: itemIds[0], edit: false }
      : { kind: "frees", itemIds },
    itemIds,
  };
}

function cloneRegionWithNewIds(region: CanvasRegion, newId: CanvasIdGenerator): CanvasRegion {
  const clone = structuredClone(region);
  clone.id = newId();
  for (const section of clone.sections) {
    section.id = newId();
    for (const column of section.columns) {
      column.id = newId();
      for (const block of column.blocks) block.id = newId();
    }
  }
  return clone;
}

function blocksInRegion(region: CanvasRegion): CanvasBlock[] {
  return region.sections.flatMap((section) => section.columns.flatMap((column) => column.blocks));
}

function plainTextFromBlocks(blocks: readonly CanvasBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text.trim()) parts.push(block.text);
    else if (block.type === "button" && block.label.trim()) parts.push(block.label);
    else if (block.type === "materialCard") {
      if (block.title.trim()) parts.push(block.title);
      if (block.text.trim()) parts.push(block.text);
    } else if (block.type === "image" && block.alt?.trim()) parts.push(block.alt);
  }
  return parts.join("\n");
}

function isFreeConvertible(block: CanvasBlock): boolean {
  return block.type === "text" || block.type === "image";
}

function overBlockLimit(doc: CanvasDoc, added: number): boolean {
  return countBlocks(doc) + added > CANVAS_LIMITS.maxBlocks;
}

function countBlocks(doc: CanvasDoc): number {
  let count = 0;
  for (const board of doc.boards) {
    for (const region of board.regions) count += blocksInRegion(region).length;
  }
  return count;
}

function columnLength(doc: CanvasDoc, columnId: string): number | null {
  for (const board of doc.boards) {
    for (const region of board.regions) {
      for (const section of region.sections) {
        const column = section.columns.find((entry) => entry.id === columnId);
        if (column) return column.blocks.length;
      }
    }
  }
  return null;
}

function nextZIndex(doc: CanvasDoc): number {
  return doc.freeItems.reduce((max, item) => Math.max(max, item.zIndex), 0) + 1;
}

function cloneDoc(doc: CanvasDoc): CanvasDoc {
  const draft = structuredClone(doc);
  draft.schemaVersion = CANVAS_SCHEMA_VERSION;
  return draft;
}

interface ClipboardMemory {
  payload: CanvasClipboardPayload;
  pasteCount: number;
  systemText: string;
  systemConfirmed: boolean;
  generation: number;
}

let memory: ClipboardMemory | null = null;
let generation = 0;
let plainPaste: { text: string; count: number } | null = null;

export function rememberCanvasClipboard(payload: CanvasClipboardPayload): void {
  generation += 1;
  memory = {
    payload,
    pasteCount: 0,
    systemText: payload.plainText,
    systemConfirmed: false,
    generation,
  };
}

export function readCanvasClipboard(): ClipboardMemory | null {
  return memory;
}

export function hasCanvasClipboard(): boolean {
  return memory !== null;
}

export function confirmCanvasClipboardWrite(writtenGeneration = memory?.generation): void {
  if (memory && memory.generation === writtenGeneration) memory.systemConfirmed = true;
}

export function noteCanvasClipboardPasted(): void {
  if (memory) memory.pasteCount += 1;
}

/** 系统剪贴板文本与上次成功写入不同，才认为画布内剪贴板过期。空文本不算「另一份内容」。 */
export function shouldPasteInternalClipboard(systemText: string): boolean {
  if (!memory) return false;
  if (!memory.systemConfirmed) return true;
  if (!systemText) return true;
  return systemText === memory.systemText;
}

export function plainTextPasteIndex(text: string): number {
  return plainPaste?.text === text ? plainPaste.count : 0;
}

export function notePlainTextPasted(text: string): void {
  plainPaste = { text, count: plainTextPasteIndex(text) + 1 };
}

export function resetCanvasClipboardMemory(): void {
  memory = null;
  plainPaste = null;
}
