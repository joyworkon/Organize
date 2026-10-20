import { beforeEach, describe, expect, it } from "vitest";
import { CANVAS_LIMITS } from "./validation";
import {
  CANVAS_SCHEMA_VERSION,
  createButtonBlock,
  createDividerBlock,
  createImageBlock,
  createMaterialCardBlock,
  createTextBlock,
  emptyDoc,
  findBlockLocation,
  type CanvasBlock,
  type CanvasBoard,
  type CanvasDoc,
  type CanvasFreeItem,
  type CanvasIdGenerator,
  type CanvasRegion,
  type CanvasSection,
} from "./model";
import { FREE_ITEM_DUPLICATE_OFFSET, createBoard, createFreeText, updateFreeItemBlock, updateTextBlock } from "./commands";
import {
  confirmCanvasClipboardWrite,
  copyCanvasSelection,
  noteCanvasClipboardPasted,
  pasteCanvasClipboard,
  pastePlainTextAsFreeItem,
  plainTextPasteIndex,
  readCanvasClipboard,
  rememberCanvasClipboard,
  resetCanvasClipboardMemory,
  shouldPasteInternalClipboard,
  type CanvasPasteTarget,
} from "./clipboard";

const OFFSET = FREE_ITEM_DUPLICATE_OFFSET;

beforeEach(() => {
  resetCanvasClipboardMemory();
});

function ids(prefix = "n"): CanvasIdGenerator {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function text(id: string, value = "t"): CanvasBlock {
  return { id, type: "text", text: value, role: "body" };
}

function section(id: string, blocks: CanvasBlock[]): CanvasSection {
  return { id, widthMode: "equal", columnWeights: [1], columns: [{ id: `${id}-c`, blocks }] };
}

function region(id: string, sections: CanvasSection[]): CanvasRegion {
  return { id, name: "内容", sections };
}

function board(id: string, regions: CanvasRegion[]): CanvasBoard {
  return { id, x: 0, y: 0, width: 640, padding: 24, gap: 16, regions };
}

function docOf(regions: CanvasRegion[], freeItems: CanvasFreeItem[] = [], boardId = "bd"): CanvasDoc {
  return { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [board(boardId, regions)], freeItems };
}

function blocksIn(doc: CanvasDoc): CanvasBlock[] {
  return doc.boards.flatMap((entry) => entry.regions).flatMap((entry) =>
    entry.sections.flatMap((sectionEntry) => sectionEntry.columns.flatMap((column) => column.blocks)));
}

function target(partial: Partial<CanvasPasteTarget> = {}): CanvasPasteTarget {
  return { pointer: null, pasteIndex: 0, selection: null, explicit: null, ...partial };
}

function freeItem(id: string, x: number, y: number, value: string, zIndex: number): CanvasFreeItem {
  return { id, x, y, width: 240, zIndex, block: { id: `${id}-b`, type: "text", text: value, role: "body" } };
}

describe("copyCanvasSelection", () => {
  it("deep-copies free items in z order and leaves the document alone", () => {
    const doc = docOf([], [freeItem("f2", 130, 80, "world", 2), freeItem("f1", 100, 50, "hello", 5)]);
    const payload = copyCanvasSelection(doc, { kind: "frees", itemIds: ["f1", "f2", "missing"] });
    expect(payload?.kind).toBe("free");
    if (payload?.kind !== "free") return;
    expect(payload.items.map((item) => item.id)).toEqual(["f2", "f1"]);
    expect(payload.plainText).toBe("world\nhello");
    payload.items[0].x = 999;
    payload.items[0].block = { ...payload.items[0].block, text: "changed" } as CanvasFreeItem["block"];
    expect(doc.freeItems[0].x).toBe(130);
    expect(doc.freeItems[0].block).toMatchObject({ text: "world" });
  });

  it("copies blocks in document order and regions with their source board", () => {
    const button = createButtonBlock(ids("b"));
    button.label = "去看看";
    const card = createMaterialCardBlock({
      title: "资料",
      text: "摘录",
      sourceRef: { kind: "memo", id: "m1", title: "资料" },
    }, ids("c"));
    const image = createImageBlock(null, ids("i"));
    image.alt = "配图";
    const doc = docOf([
      region("r1", [section("s1", [text("t1", "标题"), button])]),
      region("r2", [section("s2", [card, image, createDividerBlock(ids("d"))])]),
    ]);
    const blocks = copyCanvasSelection(doc, { kind: "blocks", blockIds: ["t1", button.id, card.id, image.id] });
    expect(blocks).toMatchObject({
      kind: "blocks",
      plainText: "标题\n去看看\n资料\n摘录\n配图",
    });
    const regionPayload = copyCanvasSelection(doc, { kind: "region", boardId: "bd", regionId: "r2" });
    expect(regionPayload?.kind).toBe("region");
    if (regionPayload?.kind !== "region") return;
    expect(regionPayload.sourceBoardId).toBe("bd");
    expect(regionPayload.region.id).toBe("r2");
    expect(regionPayload.plainText).toBe("资料\n摘录\n配图");
    regionPayload.region.name = "改掉";
    expect(doc.boards[0].regions[1].name).toBe("内容");
  });

  it("returns null for a board, an empty selection, or ids that are gone", () => {
    const doc = docOf([region("r", [section("s", [text("t", "a")])])]);
    expect(copyCanvasSelection(doc, { kind: "board", boardId: "bd" })).toBeNull();
    expect(copyCanvasSelection(doc, null)).toBeNull();
    expect(copyCanvasSelection(doc, { kind: "block", blockId: "missing" })).toBeNull();
    expect(copyCanvasSelection(doc, { kind: "free", itemId: "missing" })).toBeNull();
    expect(copyCanvasSelection(doc, { kind: "region", boardId: "other", regionId: "r" })).toBeNull();
  });
});

describe("paste free items", () => {
  const doc = docOf([], [freeItem("keep", 0, 0, "stay", 3)]);

  it("anchors the group at the pointer and keeps relative positions", () => {
    const payload = copyCanvasSelection(
      docOf([], [freeItem("a", 100, 50, "hello", 1), freeItem("b", 130, 80, "world", 2)]),
      { kind: "frees", itemIds: ["a", "b"] },
    );
    expect(payload?.kind).toBe("free");
    if (payload?.kind !== "free") return;
    const first = pasteCanvasClipboard(doc, payload, target({ pointer: { x: 5, y: 6 }, pasteIndex: 0 }), ids());
    expect(first.rejected).toBeUndefined();
    expect(first.doc).not.toBe(doc);
    expect(first.itemIds).toHaveLength(2);
    expect(first.focus).toEqual({ kind: "frees", itemIds: first.itemIds });
    const placed = first.doc.freeItems.slice(1);
    expect(placed.map((item) => [item.x, item.y])).toEqual([[5, 6], [35, 36]]);
    expect(placed.map((item) => item.zIndex)).toEqual([4, 5]);
    expect(placed.map((item) => item.block.type === "text" ? item.block.text : "")).toEqual(["hello", "world"]);
    expect(new Set([placed[0].id, placed[0].block.id, placed[1].id, placed[1].block.id]).size).toBe(4);
    expect(doc.freeItems).toHaveLength(1);

    const second = pasteCanvasClipboard(doc, payload, target({ pointer: { x: 5, y: 6 }, pasteIndex: 1 }), ids("p"));
    expect(second.doc.freeItems.slice(1).map((item) => [item.x, item.y])).toEqual([[29, 30], [59, 60]]);
  });

  it("offsets from the original origin when the pointer is unknown", () => {
    const payload = copyCanvasSelection(
      docOf([], [freeItem("a", 100, 50, "hello", 1), freeItem("b", 130, 80, "world", 2)]),
      { kind: "frees", itemIds: ["a", "b"] },
    );
    if (payload?.kind !== "free") throw new Error("payload");
    const pasted = pasteCanvasClipboard(doc, payload, target({ pasteIndex: 0 }), ids());
    expect(pasted.doc.freeItems.slice(1).map((item) => [item.x, item.y])).toEqual([
      [100 + OFFSET, 50 + OFFSET],
      [130 + OFFSET, 80 + OFFSET],
    ]);
  });

  it("rejects the whole paste at the free-item cap", () => {
    const full = docOf([], Array.from({ length: CANVAS_LIMITS.maxFreeItems }, (_, index) => freeItem(`f${index}`, index, 0, "a", index + 1)));
    const payload = copyCanvasSelection(full, { kind: "free", itemId: "f0" });
    if (payload?.kind !== "free") throw new Error("payload");
    const result = pasteCanvasClipboard(full, payload, target({ pointer: { x: 1, y: 1 } }), ids());
    expect(result.doc).toBe(full);
    expect(result.rejected).toBe(`自由元素已达 ${CANVAS_LIMITS.maxFreeItems} 个上限，这次没有粘贴`);
  });
});

describe("paste blocks", () => {
  it("inserts after the selected block with new ids and does not enter edit mode", () => {
    const doc = docOf([region("r", [section("s", [text("a", "甲"), text("b", "乙")])])]);
    const payload = copyCanvasSelection(doc, { kind: "blocks", blockIds: ["a", "b"] });
    if (payload?.kind !== "blocks") throw new Error("payload");
    const result = pasteCanvasClipboard(doc, payload, target({
      selection: { kind: "block", blockId: "b" },
      explicit: { kind: "region-end", boardId: "bd", regionId: "r" },
    }), ids());
    expect(result.rejected).toBeUndefined();
    expect(result.blockIds).toHaveLength(2);
    expect(result.focus).toBeUndefined();
    const column = result.doc.boards[0].regions[0].sections[0].columns[0].blocks;
    expect(column.map((block) => block.id)).toEqual(["a", "b", result.blockIds![0], result.blockIds![1]]);
    expect(column.map((block) => block.type === "text" ? block.text : "")).toEqual(["甲", "乙", "甲", "乙"]);
  });

  it("uses the pointer hit when no single block is selected", () => {
    const doc = docOf([
      region("r", [section("s", [text("a", "甲")])]),
    ]);
    const extra = section("other", [text("z", "末")]);
    doc.boards[0].regions[0].sections.push(extra);
    const payload = copyCanvasSelection(doc, { kind: "block", blockId: "a" });
    if (payload?.kind !== "blocks") throw new Error("payload");
    const result = pasteCanvasClipboard(doc, payload, target({
      selection: { kind: "blocks", blockIds: ["a"] },
      explicit: { kind: "column", boardId: "bd", regionId: "r", sectionId: "other", columnId: "other-c" },
      pointer: { x: 10, y: 10 },
    }), ids());
    const landed = result.doc.boards[0].regions[0].sections[1].columns[0].blocks;
    expect(landed.map((block) => block.type === "text" ? block.text : "")).toEqual(["末", "甲"]);
    expect(result.focus).toMatchObject({ kind: "block", edit: false });
  });

  it("turns text and image into free items, and parks other types on the first board", () => {
    const doc = docOf([region("r", [section("s", [text("keep", "留")])])]);
    const textPayload = {
      kind: "blocks" as const,
      blocks: [createTextBlock("body", "自由", ids("src")), createImageBlock(null, ids("img"))],
      plainText: "自由",
    };
    const converted = pasteCanvasClipboard(doc, textPayload, target({ pointer: { x: 12, y: 18 }, pasteIndex: 0 }), ids());
    expect(converted.rejected).toBeUndefined();
    expect(blocksIn(converted.doc)).toHaveLength(1);
    expect(converted.doc.freeItems.map((item) => [item.x, item.y, item.width, item.block.type])).toEqual([
      [12, 18, 240, "text"],
      [12, 18 + OFFSET, 320, "image"],
    ]);
    expect(converted.focus).toEqual({ kind: "frees", itemIds: converted.itemIds });

    const parked = pasteCanvasClipboard(doc, {
      kind: "blocks",
      blocks: [createButtonBlock(ids("btn")), createDividerBlock(ids("div"))],
      plainText: "",
    }, target(), ids("p"));
    const added = blocksIn(parked.doc).slice(1);
    expect(added.map((block) => block.type)).toEqual(["button", "divider"]);
    expect(parked.doc.freeItems).toHaveLength(0);

    const mixed = pasteCanvasClipboard(doc, {
      kind: "blocks",
      blocks: [text("mix", "混"), createButtonBlock(ids("btn2"))],
      plainText: "混",
    }, target({ pointer: { x: 1, y: 1 } }), ids("m"));
    expect(mixed.doc.freeItems).toHaveLength(0);
    expect(blocksIn(mixed.doc).map((block) => block.type)).toEqual(["text", "text", "button"]);
  });

  it("rejects a full column or a full document without pasting part of the payload", () => {
    const fullColumn = docOf([region("r", [section("s", Array.from({ length: 20 }, (_, index) => text(`b${index}`)))])]);
    const one = { kind: "blocks" as const, blocks: [text("new", "新")], plainText: "新" };
    const columnResult = pasteCanvasClipboard(fullColumn, one, target({ selection: { kind: "block", blockId: "b0" } }), ids());
    expect(columnResult.doc).toBe(fullColumn);
    expect(columnResult.rejected).toBe(`这一列已达 ${CANVAS_LIMITS.maxBlocksPerColumn} 个模块上限，这次没有粘贴`);
    expect(fullColumn.freeItems).toHaveLength(0);

    const sections = Array.from({ length: 20 }, (_, index) => section(`s${index}`, Array.from({ length: 20 }, (__, block) => text(`b${index}-${block}`))));
    const fullDoc = docOf([region("r", sections)]);
    expect(blocksIn(fullDoc)).toHaveLength(400);
    const total = pasteCanvasClipboard(fullDoc, one, target({
      explicit: { kind: "region-end", boardId: "bd", regionId: "r" },
    }), ids());
    expect(total.doc).toBe(fullDoc);
    expect(total.rejected).toBe(`模块已达 ${CANVAS_LIMITS.maxBlocks} 个上限，这次没有粘贴`);

    const asFree = pasteCanvasClipboard(fullDoc, one, target({ pointer: { x: 4, y: 8 } }), ids("f"));
    expect(asFree.rejected).toBeUndefined();
    expect(blocksIn(asFree.doc)).toHaveLength(400);
    expect(asFree.doc.freeItems).toHaveLength(1);
    expect(asFree.doc.freeItems[0].block).toMatchObject({ type: "text", text: "新" });
  });

  it("does not invent a column or a region for a stale hit target", () => {
    const doc = docOf([region("r", [section("s", [text("a", "甲")])])]);
    const payload = { kind: "blocks" as const, blocks: [createButtonBlock(ids("b"))], plainText: "" };
    const missingColumn = pasteCanvasClipboard(doc, payload, target({
      explicit: { kind: "column", boardId: "bd", regionId: "r", sectionId: "s", columnId: "gone" },
    }), ids());
    expect(missingColumn.doc).toBe(doc);
    expect(missingColumn.rejected).toBe("没有可放置的版面，这次没有粘贴");
    const missingRegion = pasteCanvasClipboard(doc, payload, target({
      explicit: { kind: "region-end", boardId: "bd", regionId: "gone" },
    }), ids());
    expect(missingRegion.doc).toBe(doc);
    const blank = emptyDoc();
    const noBoard = pasteCanvasClipboard(blank, payload, target(), ids());
    expect(noBoard.doc).toBe(blank);
    expect(noBoard.rejected).toBe("没有可放置的版面，这次没有粘贴");
  });
});

describe("paste regions", () => {
  function sample(): CanvasDoc {
    return docOf([
      region("r1", [section("s1", [text("a", "头")])]),
      region("r2", [section("s2", [text("b", "尾")])]),
    ]);
  }

  it("inserts after the selected region, otherwise after the original", () => {
    const doc = sample();
    const payload = copyCanvasSelection(doc, { kind: "region", boardId: "bd", regionId: "r1" });
    if (payload?.kind !== "region") throw new Error("payload");
    const afterSelected = pasteCanvasClipboard(doc, payload, target({
      selection: { kind: "region", boardId: "bd", regionId: "r2" },
    }), ids());
    expect(afterSelected.doc.boards[0].regions.map((entry) => entry.name)).toEqual(["内容", "内容", "内容"]);
    expect(afterSelected.doc.boards[0].regions.map((entry) => entry.sections[0].columns[0].blocks[0]).map((block) =>
      block.type === "text" ? block.text : "")).toEqual(["头", "尾", "头"]);
    expect(afterSelected.focus).toMatchObject({ kind: "region", boardId: "bd" });
    const clone = afterSelected.doc.boards[0].regions[2];
    expect(clone.id).not.toBe("r1");
    expect(clone.sections[0].id).not.toBe("s1");
    expect(clone.sections[0].columns[0].id).not.toBe("s1-c");
    expect(clone.sections[0].columns[0].blocks[0].id).not.toBe("a");

    const afterOriginal = pasteCanvasClipboard(doc, payload, target(), ids("o"));
    expect(afterOriginal.doc.boards[0].regions.map((entry) => entry.sections[0].columns[0].blocks[0]).map((block) =>
      block.type === "text" ? block.text : "")).toEqual(["头", "头", "尾"]);
  });

  it("appends when the original region is gone, including onto another canvas", () => {
    const doc = sample();
    const payload = copyCanvasSelection(doc, { kind: "region", boardId: "bd", regionId: "r1" });
    if (payload?.kind !== "region") throw new Error("payload");
    const cut = docOf([region("r2", [section("s2", [text("b", "尾")])])]);
    const appended = pasteCanvasClipboard(cut, payload, target(), ids());
    expect(appended.doc.boards[0].regions).toHaveLength(2);
    expect(appended.doc.boards[0].regions[1].sections[0].columns[0].blocks[0]).toMatchObject({ type: "text", text: "头" });

    const other = docOf([region("only", [section("os", [text("z", "别")])])], [], "other");
    const crossed = pasteCanvasClipboard(other, payload, target(), ids("x"));
    expect(crossed.doc.boards[0].id).toBe("other");
    expect(crossed.doc.boards[0].regions).toHaveLength(2);
    expect(crossed.focus).toMatchObject({ boardId: "other" });
  });

  it("rejects a board that already has the region cap, and a document at the block cap", () => {
    const regions = Array.from({ length: CANVAS_LIMITS.maxRegionsPerBoard }, (_, index) => region(`r${index}`, []));
    const doc = docOf(regions);
    const payload = copyCanvasSelection(sample(), { kind: "region", boardId: "bd", regionId: "r1" });
    if (payload?.kind !== "region") throw new Error("payload");
    const result = pasteCanvasClipboard(doc, payload, target(), ids());
    expect(result.doc).toBe(doc);
    expect(result.rejected).toBe(`这个版面的区块已达 ${CANVAS_LIMITS.maxRegionsPerBoard} 个上限，这次没有粘贴`);

    const sections = Array.from({ length: 20 }, (_, index) => section(`s${index}`, Array.from({ length: 20 }, (__, block) => text(`b${index}-${block}`))));
    const full = docOf([region("r", sections)]);
    const blocked = pasteCanvasClipboard(full, payload, target(), ids());
    expect(blocked.doc).toBe(full);
    expect(blocked.rejected).toBe(`模块已达 ${CANVAS_LIMITS.maxBlocks} 个上限，这次没有粘贴`);
  });
});

describe("plain text and clipboard expiry", () => {
  it("creates one free text at the pointer and offsets the next identical paste", () => {
    const doc = emptyDoc();
    const first = pastePlainTextAsFreeItem(doc, "  外部  ", { x: 10, y: 12 }, 0, ids());
    expect(first.rejected).toBeUndefined();
    expect(first.doc.freeItems[0]).toMatchObject({ x: 10, y: 12, width: 240 });
    expect(first.doc.freeItems[0].block).toMatchObject({ type: "text", text: "  外部  " });
    expect(first.focus).toMatchObject({ kind: "free", edit: false });
    const second = pastePlainTextAsFreeItem(doc, "  外部  ", { x: 10, y: 12 }, 1, ids("p"));
    expect(second.doc.freeItems[0]).toMatchObject({ x: 10 + OFFSET, y: 12 + OFFSET });
    const parked = pastePlainTextAsFreeItem(doc, "角落", null, 0, ids("c"));
    expect(parked.doc.freeItems[0]).toMatchObject({ x: 40, y: 40 });
  });

  it("drops blank text, slices long text, and rejects a full free-item list", () => {
    const doc = emptyDoc();
    expect(pastePlainTextAsFreeItem(doc, " \n\t ", { x: 1, y: 1 }, 0).doc).toBe(doc);
    const long = pastePlainTextAsFreeItem(doc, "字".repeat(CANVAS_LIMITS.maxTextLength + 25), null, 0, ids());
    expect(long.doc.freeItems[0].block).toMatchObject({ type: "text", text: "字".repeat(CANVAS_LIMITS.maxTextLength) });
    const full = docOf([], Array.from({ length: 100 }, (_, index) => freeItem(`f${index}`, 0, 0, "a", index + 1)));
    const rejected = pastePlainTextAsFreeItem(full, "再来", { x: 1, y: 1 }, 0, ids());
    expect(rejected.doc).toBe(full);
    expect(rejected.rejected).toContain("自由元素已达");
  });

  it("treats empty or unconfirmed system text as the same clipboard, and a different confirmed text as expired", () => {
    expect(shouldPasteInternalClipboard("anything")).toBe(false);
    const payload = copyCanvasSelection(docOf([region("r", [section("s", [text("a", "甲")])])]), { kind: "block", blockId: "a" });
    if (!payload) throw new Error("payload");
    rememberCanvasClipboard(payload);
    expect(shouldPasteInternalClipboard("别的")).toBe(true);
    expect(readCanvasClipboard()?.systemConfirmed).toBe(false);
    confirmCanvasClipboardWrite();
    expect(shouldPasteInternalClipboard("")).toBe(true);
    expect(shouldPasteInternalClipboard(payload.plainText)).toBe(true);
    expect(shouldPasteInternalClipboard("别的")).toBe(false);
    const firstGeneration = readCanvasClipboard()?.generation;
    rememberCanvasClipboard(payload);
    confirmCanvasClipboardWrite(firstGeneration);
    expect(readCanvasClipboard()?.systemConfirmed).toBe(false);
    noteCanvasClipboardPasted();
    expect(plainTextPasteIndex("外部")).toBe(0);
    expect(readCanvasClipboard()?.pasteCount).toBe(1);
  });
});

describe("command-built documents", () => {
  it("copies a real free item without changing the source text", () => {
    let doc = createFreeText(emptyDoc(), { x: 8, y: 9 }).doc;
    const itemId = doc.freeItems[0].id;
    doc = updateFreeItemBlock(doc, { itemId, text: "原文" }).doc;
    const payload = copyCanvasSelection(doc, { kind: "free", itemId });
    if (payload?.kind !== "free") throw new Error("payload");
    const pasted = pasteCanvasClipboard(doc, payload, target({ pointer: { x: 3, y: 4 } }), ids());
    expect(pasted.doc.freeItems).toHaveLength(2);
    expect(pasted.doc.freeItems[1].block).toMatchObject({ type: "text", text: "原文" });
    expect(findBlockLocation(doc, doc.freeItems[0].block.id)).toBeNull();
    expect(doc.freeItems[0].block).toMatchObject({ text: "原文" });
    const boardDoc = createBoard(emptyDoc(), { x: 0, y: 0 }).doc;
    const blockId = boardDoc.boards[0].regions[0].sections[0].columns[0].blocks[0].id;
    const named = updateTextBlock(boardDoc, { blockId, text: "标题" }).doc;
    expect(copyCanvasSelection(named, { kind: "block", blockId })?.plainText).toBe("标题");
  });
});
