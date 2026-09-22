import { describe, expect, it } from "vitest";
import { emptyDoc, findBlockLocation, findFreeItem, type CanvasImageAsset } from "@/lib/canvas/model";
import { createBoard, deleteBlock } from "@/lib/canvas/commands";
import { createCanvasStore } from "@/components/canvas/canvas-store";
import { isUploadingAsset, replaceImage, startImageInsert } from "./image-insert";
import type { CanvasUploadOutcome } from "./assets";

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function makeFile(name = "a.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

function savedOutcome(name = "a.png"): CanvasUploadOutcome {
  return {
    asset: {
      url: `/storage/test/${name}`,
      naturalWidth: 800,
      naturalHeight: 600,
      name,
      uploadStatus: "saved",
    },
  };
}

/** 受控上传：promise 由测试决定何时完成。 */
function controlledUpload(outcome: CanvasUploadOutcome) {
  let release!: (o: CanvasUploadOutcome) => void;
  let rejectUpload!: (e: Error) => void;
  const gate = new Promise<CanvasUploadOutcome>((resolve, reject) => {
    release = resolve;
    rejectUpload = reject;
  });
  const upload = async () => gate;
  return { upload, release, rejectUpload };
}

function boardStore() {
  const store = createCanvasStore({ doc: emptyDoc() });
  store.getState().apply("建版面", (d) => createBoard(d, { x: 0, y: 0 }, counterIds()));
  const board = store.getState().doc.boards[0];
  const titleId = board.regions[0].sections[0].columns[0].blocks[0].id;
  return { store, board, titleId };
}

function allImageBlocks(store: ReturnType<typeof createCanvasStore>) {
  const out: CanvasImageAsset[] = [];
  for (const b of store.getState().doc.boards) {
    for (const r of b.regions) {
      for (const s of r.sections) {
        for (const c of s.columns) {
          for (const k of c.blocks) if (k.type === "image") out.push(k.asset!);
        }
      }
    }
  }
  return out;
}

describe("startImageInsert 状态机（B2）", () => {
  it("上传中：立即在目标位置插入占位（pending、无 localKey、上传中语义）", async () => {
    const { store, board, titleId } = boardStore();
    const { upload, release } = controlledUpload(savedOutcome());
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    const promise = startImageInsert({ store, target, files: [makeFile()], upload, userId: "u" });
    await Promise.resolve();
    // 占位已插入：同列标题块之后
    const column = store.getState().doc.boards[0].regions[0].sections[0].columns[0];
    expect(column.blocks).toHaveLength(2);
    const placeholder = column.blocks[1];
    expect(placeholder.type).toBe("image");
    expect(isUploadingAsset(placeholder.type === "image" ? placeholder.asset : null)).toBe(true);
    release(savedOutcome());
    await promise;
  });

  it("成功：原地更新为 saved，块位置不变（同列其后）", async () => {
    const { store, board, titleId } = boardStore();
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    await startImageInsert({ store, target, files: [makeFile()], upload: async () => savedOutcome(), userId: "u" });
    const column = store.getState().doc.boards[0].regions[0].sections[0].columns[0];
    expect(column.blocks).toHaveLength(2);
    const img = column.blocks[1];
    expect(img.type).toBe("image");
    if (img.type === "image") {
      expect(img.asset?.uploadStatus).toBe("saved");
      expect(img.asset?.url).toBe("/storage/test/a.png");
    }
  });

  it("失败（抛错）：占位原地转 failed（无本机键 → 重新选择链路）", async () => {
    const { store, board, titleId } = boardStore();
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    await startImageInsert({
      store,
      target,
      files: [makeFile()],
      upload: async () => {
        throw new Error("图片不能超过 5MB");
      },
      userId: "u",
    });
    const img = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[1];
    expect(img.type).toBe("image");
    if (img.type === "image") {
      expect(img.asset?.uploadStatus).toBe("failed");
      expect(img.asset?.localKey).toBeUndefined();
    }
  });

  it("上传期间改变选区：不影响在途目标（快照语义）", async () => {
    const { store, board, titleId } = boardStore();
    const { upload, release } = controlledUpload(savedOutcome());
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    const promise = startImageInsert({ store, target, files: [makeFile()], upload, userId: "u" });
    await Promise.resolve();
    // 上传在途：用户点选标题块、再选中页面
    store.getState().select({ kind: "block", blockId: titleId });
    store.getState().select({ kind: "board", boardId: board.id });
    release(savedOutcome());
    await promise;
    // 图片仍落在原目标列（标题块之后），没有因选区变化而漂移
    const column = store.getState().doc.boards[0].regions[0].sections[0].columns[0];
    expect(column.blocks[1].type).toBe("image");
  });

  it("占位被删除 + 上传成功：转「待重新放置」自由图片，绝不插回区块", async () => {
    const { store, board, titleId } = boardStore();
    const { upload, release } = controlledUpload(savedOutcome("late.png"));
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    const orphaned: string[] = [];
    const promise = startImageInsert({
      store,
      target,
      files: [makeFile("late.png")],
      upload,
      userId: "u",
      fallbackPosition: () => ({ x: 900, y: 500 }),
      onOrphaned: (name) => orphaned.push(name),
    });
    await Promise.resolve();
    const placeholderId = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[1].id;
    // 用户删除占位块
    store.getState().apply("删除占位", (d) => deleteBlock(d, { blockId: placeholderId }));
    release(savedOutcome("late.png"));
    const summary = await promise;

    expect(summary.orphaned).toEqual(["late.png"]);
    expect(orphaned).toEqual(["late.png"]);
    // 版面内没有图片块被插回（删除占位时空列被回收）
    expect(allImageBlocks(store)).toHaveLength(0);
    // 自由图片承接资产
    const item = store.getState().doc.freeItems[0];
    expect(item).toBeDefined();
    expect(item.x).toBe(900);
    expect(item.y).toBe(500);
    expect(item.block.type).toBe("image");
    if (item.block.type === "image") {
      expect(item.block.asset?.uploadStatus).toBe("saved");
      expect(item.block.asset?.url).toBe("/storage/test/late.png");
    }
  });

  it("占位被删除 + 上传失败：随占位丢弃，不产生自由项", async () => {
    const { store, board, titleId } = boardStore();
    const { upload, rejectUpload } = controlledUpload(savedOutcome());
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    const promise = startImageInsert({ store, target, files: [makeFile()], upload, userId: "u" });
    await Promise.resolve();
    const placeholderId = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[1].id;
    store.getState().apply("删除占位", (d) => deleteBlock(d, { blockId: placeholderId }));
    rejectUpload(new Error("网络错误"));
    const summary = await promise;
    expect(summary.inserted).toBe(0);
    expect(summary.orphaned).toHaveLength(0);
    expect(store.getState().doc.freeItems).toHaveLength(0);
    expect(allImageBlocks(store)).toHaveLength(0);
  });

  it("多图：按选择顺序依次进入同一目标容器（同列顺序追加）", async () => {
    const { store, board, titleId } = boardStore();
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    const names = ["1.png", "2.png", "3.png"];
    await startImageInsert({
      store,
      target,
      files: names.map((n) => makeFile(n)),
      upload: async (file) => savedOutcome(file.name),
      userId: "u",
    });
    const column = store.getState().doc.boards[0].regions[0].sections[0].columns[0];
    expect(column.blocks).toHaveLength(4); // 标题 + 3 图
    const order = column.blocks.slice(1).map((b) => (b.type === "image" ? b.asset?.name : ""));
    expect(order).toEqual(["1.png", "2.png", "3.png"]);
  });

  it("非图片文件：校验前置失败，不插入占位", async () => {
    const { store, board, titleId } = boardStore();
    const invalid: string[] = [];
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    const summary = await startImageInsert({
      store,
      target,
      files: [new File(["x"], "notes.txt", { type: "text/plain" })],
      upload: async () => savedOutcome(),
      userId: "u",
      onInvalidFile: (file, reason) => invalid.push(`${file.name}:${reason}`),
    });
    expect(summary.invalid).toBe(1);
    expect(invalid).toHaveLength(1);
    expect(store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks).toHaveLength(1);
  });

  it("create:page 目标：拒绝隐式建页（由调用方先建页面再解析）", async () => {
    const store = createCanvasStore({ doc: emptyDoc() });
    const summary = await startImageInsert({
      store,
      target: { create: "page" },
      files: [makeFile()],
      upload: async () => savedOutcome(),
      userId: "u",
    });
    expect(summary.inserted).toBe(0);
    expect(store.getState().doc.boards).toHaveLength(0);
  });
});

describe("replaceImage（B2 替换图片）", () => {
  it("替换成功：保留块位置、ratio、fit、alt 与样式", async () => {
    const { store, board, titleId } = boardStore();
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    await startImageInsert({ store, target, files: [makeFile("old.png")], upload: async () => savedOutcome("old.png"), userId: "u" });
    const blockId = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[1].id;
    // 用户改了 ratio/fit/alt/背景
    store.getState().apply("比例", (d) => {
      const loc = findBlockLocation(d, blockId);
      if (loc && loc.block.type === "image") {
        loc.block.ratio = "16:9";
        loc.block.fit = "cover";
        loc.block.alt = "示意图";
        loc.block.style = { background: "gray" };
      }
      return { doc: d };
    });

    await replaceImage({
      store,
      blockId,
      file: makeFile("new.png"),
      upload: async () => ({
        asset: { url: "/storage/test/new.png", naturalWidth: 100, naturalHeight: 100, name: "new.png", uploadStatus: "saved" },
      }),
      userId: "u",
    });

    const loc = findBlockLocation(store.getState().doc, blockId);
    expect(loc).not.toBeNull();
    expect(loc!.block.type).toBe("image");
    if (loc!.block.type === "image") {
      expect(loc!.block.asset?.url).toBe("/storage/test/new.png");
      expect(loc!.block.asset?.name).toBe("new.png");
      expect(loc!.block.ratio).toBe("16:9");
      expect(loc!.block.fit).toBe("cover");
      expect(loc!.block.alt).toBe("示意图");
      expect(loc!.block.style?.background).toBe("gray");
    }
  });

  it("替换硬失败：保留旧图", async () => {
    const { store, board, titleId } = boardStore();
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    await startImageInsert({ store, target, files: [makeFile("old.png")], upload: async () => savedOutcome("old.png"), userId: "u" });
    const blockId = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[1].id;
    await expect(
      replaceImage({
        store,
        blockId,
        file: makeFile("big.png"),
        upload: async () => {
          throw new Error("图片不能超过 5MB");
        },
        userId: "u",
      }),
    ).rejects.toThrow("图片不能超过 5MB");
    const loc = findBlockLocation(store.getState().doc, blockId);
    if (loc!.block.type === "image") {
      expect(loc!.block.asset?.url).toBe("/storage/test/old.png");
    }
  });

  it("替换期间块被删：上传成功的资产转「待重新放置」自由图片", async () => {
    const { store, board, titleId } = boardStore();
    const target = {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: board.regions[0].sections[0].columns[0].id,
      afterBlockId: titleId,
    };
    await startImageInsert({ store, target, files: [makeFile("old.png")], upload: async () => savedOutcome("old.png"), userId: "u" });
    const blockId = store.getState().doc.boards[0].regions[0].sections[0].columns[0].blocks[1].id;
    store.getState().apply("删除旧图", (d) => deleteBlock(d, { blockId }));
    await replaceImage({
      store,
      blockId,
      file: makeFile("new.png"),
      upload: async () => savedOutcome("new.png"),
      userId: "u",
    });
    expect(findBlockLocation(store.getState().doc, blockId)).toBeNull();
    const item = findFreeItem(store.getState().doc, store.getState().doc.freeItems[0]?.id ?? "");
    expect(item?.block.type).toBe("image");
  });
});
