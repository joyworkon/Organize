// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmbedBlock, emptyDoc, findBlockLocation, type CanvasEmbedBlock } from "@/lib/canvas/model";
import { createBoard, insertBlockAtTarget } from "@/lib/canvas/commands";
import { createCanvasStore } from "./canvas-store";
import { CanvasEmbedBlockView } from "./canvas-block";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

// jsdom 无 PointerEvent：按 canvas-free-multi.test.tsx 的同款 polyfill
function installPointerEvent() {
  if (typeof globalThis.PointerEvent === "function") return;
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}
installPointerEvent();

/** store 文档里真的持有该块（自愈 / 重试 / 选中都要能在文档中找到它）。 */
function storeWithBlock(block: CanvasEmbedBlock) {
  const store = createCanvasStore({ doc: emptyDoc() });
  store.getState().apply("建版面", (d) => createBoard(d, { x: 0, y: 0 }));
  const board = store.getState().doc.boards[0];
  store.getState().apply("插入", (d) =>
    insertBlockAtTarget(d, { kind: "region-end", boardId: board.id, regionId: board.regions[0].id }, block),
  );
  store.getState().select(null);
  return store;
}

function mount(block: CanvasEmbedBlock, opts: { interactive?: boolean; store?: ReturnType<typeof createCanvasStore> } = {}) {
  const store = opts.store ?? storeWithBlock(block);
  if (root) act(() => root!.unmount());
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(CanvasEmbedBlockView, {
        block,
        x: 0,
        y: 0,
        width: 300,
        height: 180,
        selected: false,
        store,
        interactive: opts.interactive ?? true,
      }) as ReactNode,
    );
  });
  return store;
}

function embedOf(store: ReturnType<typeof createCanvasStore>, blockId: string) {
  const loc = findBlockLocation(store.getState().doc, blockId);
  return loc && loc.block.type === "embed" ? loc.block : null;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ url: "https://example.com/a", kind: "link-card", title: "自愈解析" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  document.body.innerHTML = "";
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

function readyEmbedBlock(patch: Partial<CanvasEmbedBlock> = {}): CanvasEmbedBlock {
  return {
    ...createEmbedBlock("https://www.youtube.com/watch?v=abcdefghijk", { kind: "embed", title: "示例视频" }),
    html: '<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk"></iframe>',
    sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation",
    status: "ready",
    ...patch,
  };
}

function readyLinkCard(patch: Partial<CanvasEmbedBlock> = {}): CanvasEmbedBlock {
  const block = createEmbedBlock("https://example.com/post", { kind: "link-card", title: "示例文章" });
  return { ...block, status: "ready", description: "描述文本", siteName: "example.com", ...patch };
}

describe("CanvasEmbedBlockView：安全与渲染", () => {
  it("embed 态渲染 sandbox iframe，且强制剔除 allow-same-origin（即使持久化数据里带了）", () => {
    mount(readyEmbedBlock());
    const iframe = container!.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("sandbox")).toBe("allow-scripts allow-popups allow-presentation");
    expect(iframe!.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container!.querySelector(".canvas-embed-shield")).not.toBeNull();
  });

  it("预览态（interactive=false）：iframe 无遮罩可互动；link-card 整卡为新标签链接", () => {
    mount(readyEmbedBlock(), { interactive: false });
    expect(container!.querySelector(".canvas-embed-shield")).toBeNull();

    mount(readyLinkCard({ cover: "https://example.com/c.jpg" }), { interactive: false });
    const link = container!.querySelector("a.canvas-link-card-link");
    expect(link?.getAttribute("href")).toBe("https://example.com/post");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.textContent).toContain("示例文章");
    expect(link?.querySelector("img.canvas-link-card-cover")?.getAttribute("src")).toBe("https://example.com/c.jpg");
  });

  it("编辑态 link-card：单击选中块，无跳转链接包裹", () => {
    const block = readyLinkCard();
    const store = mount(block, { interactive: true });
    expect(container!.querySelector("a.canvas-link-card-link")).toBeNull();
    const host = container!.querySelector("[data-block-type='embed']") as HTMLElement;
    expect(host.getAttribute("role")).toBe("button");
    act(() => {
      host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(store.getState().selection).toEqual({ kind: "block", blockId: block.id });
  });

  it("loading 态展示解析中；挂载自愈：停在 loading 的块自动补一次解析并写回文档", async () => {
    const block: CanvasEmbedBlock = { ...createEmbedBlock("https://example.com/a", { kind: "link-card" }), status: "loading" };
    const store = mount(block, { interactive: true });
    expect(container!.querySelector("[role=status]")?.textContent).toContain("正在解析");
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/oembed", expect.objectContaining({ method: "POST" }));
    expect(embedOf(store, block.id)).toMatchObject({ status: "ready", title: "自愈解析" });
  });

  it("只读 / 预览不触发自愈解析", async () => {
    const block: CanvasEmbedBlock = { ...createEmbedBlock("https://example.com/a", { kind: "link-card" }), status: "loading" };
    mount(block, { interactive: false });
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("error 态：就地显示失败与重试按钮；点击重试重新解析并写回；预览态不显示重试", async () => {
    const block: CanvasEmbedBlock = { ...createEmbedBlock("https://example.com/fail", { kind: "embed" }), status: "error" };
    const store = mount(block, { interactive: true });
    expect(container!.querySelector("[role=alert]")?.textContent).toContain("解析失败");
    const retry = container!.querySelector<HTMLButtonElement>("button.canvas-embed-retry");
    expect(retry).not.toBeNull();
    await act(async () => {
      retry!.click();
    });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(embedOf(store, block.id)).toMatchObject({ status: "ready", kind: "link-card", title: "自愈解析" });

    mount(block, { interactive: false });
    expect(container!.querySelector("button.canvas-embed-retry")).toBeNull();
    expect(container!.querySelector("[role=alert]")?.textContent).toContain("解析失败");
  });

  it("封面加载失败只隐藏封面，不破坏卡片其余字段", () => {
    mount(readyLinkCard({ cover: "https://example.com/broken.jpg" }));
    const img = container!.querySelector<HTMLImageElement>("img.canvas-link-card-cover");
    expect(img).not.toBeNull();
    act(() => {
      img!.dispatchEvent(new Event("error"));
    });
    expect(container!.querySelector("img.canvas-link-card-cover")).toBeNull();
    expect(container!.textContent).toContain("示例文章");
    expect(container!.textContent).toContain("example.com");
  });
});
