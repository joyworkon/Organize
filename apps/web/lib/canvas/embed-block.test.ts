import { describe, expect, it } from "vitest";
import {
  EMBED_DEFAULT_SANDBOX,
  EMBED_LINK_CARD_CONTENT_HEIGHT,
  createBoardShape,
  createEmbedBlock,
  embedContentHeight,
  embedPlaceholderTitle,
  emptyDoc,
  findBlockLocation,
  isSafeEmbedUrl,
  stripEmbedSandbox,
} from "./model";
import { updateEmbedBlock } from "./commands";

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

describe("embed 模型辅助", () => {
  it("createEmbedBlock：loading 占位，kind 缺省 link-card，标题缺省主机名", () => {
    const block = createEmbedBlock("https://www.youtube.com/watch?v=x", {}, counterIds());
    expect(block).toMatchObject({
      id: "id-1",
      type: "embed",
      url: "https://www.youtube.com/watch?v=x",
      kind: "link-card",
      title: "www.youtube.com",
      status: "loading",
    });
    expect(createEmbedBlock("https://a.b", { kind: "embed", title: "自定义" }).kind).toBe("embed");
    expect(createEmbedBlock("https://a.b", { kind: "embed", title: "自定义" }).title).toBe("自定义");
  });

  it("isSafeEmbedUrl / embedPlaceholderTitle", () => {
    expect(isSafeEmbedUrl("https://x.y")).toBe(true);
    expect(isSafeEmbedUrl("HTTP://x.y")).toBe(true);
    expect(isSafeEmbedUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeEmbedUrl("")).toBe(false);
    expect(embedPlaceholderTitle("https://example.com/path")).toBe("example.com");
    expect(embedPlaceholderTitle("not a url")).toBe("正在解析链接…");
  });

  it("stripEmbedSandbox：强制剔除 allow-same-origin，空值回默认集", () => {
    expect(stripEmbedSandbox("allow-scripts allow-same-origin allow-popups")).toBe("allow-scripts allow-popups");
    expect(stripEmbedSandbox("allow-same-origin")).toBe(EMBED_DEFAULT_SANDBOX);
    expect(stripEmbedSandbox(undefined)).toBe(EMBED_DEFAULT_SANDBOX);
    expect(stripEmbedSandbox("")).toBe(EMBED_DEFAULT_SANDBOX);
    expect(stripEmbedSandbox("allow-scripts")).toBe("allow-scripts");
    expect(EMBED_DEFAULT_SANDBOX.includes("allow-same-origin")).toBe(false);
  });

  it("embedContentHeight：embed 16:9，link-card 固定", () => {
    expect(embedContentHeight({ kind: "embed" }, 320)).toBeCloseTo(180, 6);
    expect(embedContentHeight({ kind: "link-card" }, 320)).toBe(EMBED_LINK_CARD_CONTENT_HEIGHT);
  });
});

describe("updateEmbedBlock 命令", () => {
  function docWithEmbed() {
    const doc = emptyDoc();
    const board = createBoardShape({ x: 0, y: 0 }, counterIds());
    doc.boards.push(board);
    const block = createEmbedBlock("https://example.com/a", { kind: "embed" }, counterIds("e"));
    block.html = "<iframe></iframe>";
    board.regions[0].sections[0].columns[0].blocks.push(block);
    return { doc, blockId: block.id };
  }

  it("写入解析快照并置 ready；空字段删除、cover null 清空", () => {
    const { doc, blockId } = docWithEmbed();
    const next = updateEmbedBlock(doc, {
      blockId,
      kind: "embed",
      title: "视频",
      description: "",
      siteName: "youtube.com",
      provider: "YouTube",
      cover: null,
      html: "<iframe src=\"x\"></iframe>",
      sandbox: "allow-scripts",
      status: "ready",
    }).doc;
    const block = findBlockLocation(next, blockId)!.block;
    expect(block.type).toBe("embed");
    if (block.type !== "embed") return;
    expect(block.title).toBe("视频");
    expect(block.description).toBeUndefined();
    expect(block.siteName).toBe("youtube.com");
    expect(block.provider).toBe("YouTube");
    expect(block.cover).toBeUndefined();
    expect(block.html).toBe("<iframe src=\"x\"></iframe>");
    expect(block.status).toBe("ready");
    // 原文档不被修改（纯函数）
    const original = findBlockLocation(doc, blockId)!.block;
    expect(original.type === "embed" && original.title).toBe("example.com");
  });

  it("kind 切为 link-card 自动清掉 html；标题截断到上限", () => {
    const { doc, blockId } = docWithEmbed();
    const next = updateEmbedBlock(doc, { blockId, kind: "link-card", title: "t".repeat(500) }).doc;
    const block = findBlockLocation(next, blockId)!.block;
    expect(block.type === "embed" && block.html).toBeUndefined();
    expect(block.type === "embed" && block.title.length).toBe(200);
  });

  it("非 embed 块 / 不存在的块为 no-op", () => {
    const { doc } = docWithEmbed();
    const textId = doc.boards[0].regions[0].sections[0].columns[0].blocks[0].id;
    const before = JSON.stringify(doc);
    const r1 = updateEmbedBlock(doc, { blockId: textId, title: "x" }).doc;
    const r2 = updateEmbedBlock(doc, { blockId: "missing", title: "x" }).doc;
    expect(JSON.stringify(r1)).toBe(before);
    expect(JSON.stringify(r2)).toBe(before);
  });
});
