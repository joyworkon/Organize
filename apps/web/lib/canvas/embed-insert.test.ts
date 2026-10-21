import { describe, expect, it } from "vitest";
import { emptyDoc, findBlockLocation } from "@/lib/canvas/model";
import { createBoard, deleteBlock } from "@/lib/canvas/commands";
import { createCanvasStore } from "@/components/canvas/canvas-store";
import {
  matchSingleUrlText,
  normalizeEmbedUrl,
  predictEmbedKind,
  resolveEmbedBlock,
  startEmbedInsert,
  type EmbedResolveData,
  type EmbedResolveFn,
} from "./embed-insert";

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function boardStore() {
  const store = createCanvasStore({ doc: emptyDoc() });
  store.getState().apply("建版面", (d) => createBoard(d, { x: 0, y: 0 }, counterIds()));
  const board = store.getState().doc.boards[0];
  const column = board.regions[0].sections[0].columns[0];
  return {
    store,
    board,
    target: {
      kind: "column" as const,
      boardId: board.id,
      regionId: board.regions[0].id,
      sectionId: board.regions[0].sections[0].id,
      columnId: column.id,
    },
  };
}

function getEmbed(store: ReturnType<typeof createCanvasStore>, blockId: string) {
  const loc = findBlockLocation(store.getState().doc, blockId);
  return loc && loc.block.type === "embed" ? loc.block : null;
}

/** 受控解析：promise 由测试决定何时完成。 */
function controlledResolve() {
  let release!: (data: EmbedResolveData) => void;
  let rejectResolve!: (e: Error) => void;
  const gate = new Promise<EmbedResolveData>((resolve, reject) => {
    release = resolve;
    rejectResolve = reject;
  });
  const resolve: EmbedResolveFn = async () => {
    const data = await gate;
    return { ok: true, data };
  };
  return { resolve, release, rejectResolve };
}

describe("matchSingleUrlText（粘贴分流）", () => {
  it("单行 http(s) URL 命中（trim 后）", () => {
    expect(matchSingleUrlText("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(matchSingleUrlText("  http://example.com  ")).toBe("http://example.com");
  });

  it("多行 / 带附加文字 / 非 http(s) / 空串不命中", () => {
    expect(matchSingleUrlText("https://example.com\n第二行")).toBeNull();
    expect(matchSingleUrlText("看这个 https://example.com")).toBeNull();
    expect(matchSingleUrlText("javascript:alert(1)")).toBeNull();
    expect(matchSingleUrlText("ftp://example.com/f")).toBeNull();
    expect(matchSingleUrlText("   ")).toBeNull();
    expect(matchSingleUrlText("https://exa mple.com")).toBeNull();
  });
});

describe("normalizeEmbedUrl / predictEmbedKind", () => {
  it("无协议域名补 https；非法输入返回 null", () => {
    expect(normalizeEmbedUrl(" youtube.com/watch?v=abc ")).toBe("https://youtube.com/watch?v=abc");
    expect(normalizeEmbedUrl("https://a.b/c")).toBe("https://a.b/c");
    expect(normalizeEmbedUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeEmbedUrl("hello world")).toBeNull();
    expect(normalizeEmbedUrl("")).toBeNull();
  });

  it("白名单视频域预判 embed，其余 link-card（占位即最终高度）", () => {
    expect(predictEmbedKind("https://www.youtube.com/watch?v=abcdefghijk")).toBe("embed");
    expect(predictEmbedKind("https://www.bilibili.com/video/BV1xx411c7mD")).toBe("embed");
    expect(predictEmbedKind("https://youtu.be/abcdefghijk")).toBe("embed");
    expect(predictEmbedKind("https://example.com/post")).toBe("link-card");
  });
});

describe("startEmbedInsert（占位-完成模式）", () => {
  it("先插 loading 占位（kind 预判 + 标题=主机名），解析成功后原地更新快照", async () => {
    const { store, target } = boardStore();
    const okData = {
      url: "https://example.com/post",
      kind: "link-card" as const,
      title: "示例文章",
      description: "描述",
      siteName: "example.com",
      cover: "https://example.com/c.jpg",
    };
    let seenUrl = "";
    const resolve: EmbedResolveFn = async (url) => {
      seenUrl = url;
      return { ok: true, data: okData };
    };
    const summary = await startEmbedInsert({ store, target, url: "https://example.com/post", resolve, newId: counterIds("b") });
    expect(seenUrl).toBe("https://example.com/post");
    expect(summary.blockId).toBeTruthy();
    expect(summary.resolved).toBe(true);
    const block = getEmbed(store, summary.blockId!);
    expect(block).not.toBeNull();
    expect(block!.title).toBe("示例文章");
    expect(block!.status).toBe("ready");
    expect(block!.kind).toBe("link-card");
    expect(block!.cover).toBe("https://example.com/c.jpg");
  });

  it("YouTube URL 占位即 kind=embed（16:9 高度不跳）", async () => {
    const { store, target } = boardStore();
    const { resolve, release } = controlledResolve();
    const promise = startEmbedInsert({
      store,
      target,
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      resolve,
      newId: counterIds("b"),
    });
    await Promise.resolve();
    const column = store.getState().doc.boards[0].regions[0].sections[0].columns[0];
    const placeholder = column.blocks.find((b) => b.type === "embed");
    expect(placeholder && placeholder.type === "embed" && placeholder.kind).toBe("embed");
    expect(placeholder && placeholder.type === "embed" && placeholder.status).toBe("loading");
    expect(placeholder && placeholder.type === "embed" && placeholder.title).toBe("www.youtube.com");
    release({
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      kind: "embed",
      provider: "YouTube",
      title: "YouTube 视频",
      html: "<iframe src=\"https://www.youtube-nocookie.com/embed/abcdefghijk\"></iframe>",
      sandbox: "allow-scripts allow-popups allow-presentation",
    });
    const summary = await promise;
    expect(summary.resolved).toBe(true);
  });

  it("解析失败：status=error，块保留不删", async () => {
    const { store, target } = boardStore();
    const resolve: EmbedResolveFn = async () => ({ ok: false, error: "超时" });
    const summary = await startEmbedInsert({
      store,
      target,
      url: "https://example.com/x",
      resolve,
      newId: counterIds("b"),
    });
    expect(summary.resolved).toBe(false);
    const block = getEmbed(store, summary.blockId!);
    expect(block).not.toBeNull();
    expect(block!.status).toBe("error");
    expect(block!.title).toBe("example.com");
  });

  it("解析期间占位被删除：迟到结果丢弃，绝不插回", async () => {
    const { store, target } = boardStore();
    const { resolve, release } = controlledResolve();
    const promise = startEmbedInsert({
      store,
      target,
      url: "https://example.com/late",
      resolve,
      newId: counterIds("b"),
    });
    await Promise.resolve();
    const column = store.getState().doc.boards[0].regions[0].sections[0].columns[0];
    const placeholder = column.blocks.find((b) => b.type === "embed");
    expect(placeholder).toBeTruthy();
    store.getState().apply("删除占位", (d) => deleteBlock(d, { blockId: placeholder!.id }));
    release({ url: "https://example.com/late", kind: "link-card", title: "迟到" });
    const summary = await promise;
    expect(summary.resolved).toBe(false);
    expect(getEmbed(store, placeholder!.id)).toBeNull();
  });

  it("create:page 目标与非法 URL 直接拒绝", async () => {
    const empty = createCanvasStore({ doc: emptyDoc() });
    const summary = await startEmbedInsert({
      store: empty,
      target: { create: "page" },
      url: "https://example.com",
      resolve: async () => ({ ok: false, error: "不该被调用" }),
    });
    expect(summary.blockId).toBeNull();

    const { store: s2, target: t2 } = boardStore();
    const bad = await startEmbedInsert({
      store: s2,
      target: t2,
      url: "javascript:alert(1)",
      resolve: async () => ({ ok: false, error: "不该被调用" }),
    });
    expect(bad.blockId).toBeNull();
  });
});

describe("resolveEmbedBlock（重试 / 重新解析）", () => {
  async function insertReady(store: ReturnType<typeof createCanvasStore>, target: ReturnType<typeof boardStore>["target"]) {
    const summary = await startEmbedInsert({
      store,
      target,
      url: "https://example.com/a",
      resolve: async () => ({ ok: true, data: { url: "https://example.com/a", kind: "link-card", title: "第一版" } }),
      newId: counterIds("b"),
    });
    return summary.blockId!;
  }

  it("historyLabel 重新解析：一次撤销回到旧快照", async () => {
    const { store, target } = boardStore();
    const blockId = await insertReady(store, target);
    const ok = await resolveEmbedBlock({
      store,
      blockId,
      historyLabel: "重新解析链接",
      force: true,
      resolve: async () => ({ ok: true, data: { url: "https://example.com/a", kind: "link-card", title: "第二版" } }),
    });
    expect(ok).toBe(true);
    expect(getEmbed(store, blockId)!.title).toBe("第二版");
    store.getState().undo();
    expect(getEmbed(store, blockId)!.title).toBe("第一版");
  });

  it("块不存在 / URL 非法：不动文档", async () => {
    const { store } = boardStore();
    const ok = await resolveEmbedBlock({
      store,
      blockId: "nope",
      resolve: async () => ({ ok: true, data: { url: "https://x", kind: "link-card", title: "t" } }),
    });
    expect(ok).toBe(false);
  });
});
