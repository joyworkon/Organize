// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryItem } from "@organize/shared";
import { createBoardShape, type CanvasDoc } from "@/lib/canvas/model";
import { appendMaterialCardToRegion } from "@/lib/canvas/commands";
import { listCanvases, getCanvas, patchCanvas } from "@/lib/canvas/repository";
import { readCanvasAddTarget, rememberCanvasAddTarget, NEW_REGION } from "@/lib/canvas/add-target-memory";
import { toast } from "@/hooks/use-toast";
import { AddToCanvasDialog } from "./add-to-canvas-dialog";

vi.mock("@/lib/canvas/repository", () => ({ listCanvases: vi.fn(), getCanvas: vi.fn(), patchCanvas: vi.fn(), createCanvas: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "alice" } } }) } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
let root: Root;
let container: HTMLDivElement;
let doc: CanvasDoc;
const close = vi.fn();
const item: LibraryItem = { id: "memo", source_type: "memo", title: null, excerpt: "资料标题", url: null, tags: [], reading_status: null, is_pinned: false, reading_progress: null, is_link_only: false, created_at: "2026-10-20" };
const row = () => ({ id: "canvas", title: "研究画布", content: doc, revision: 4, created_at: "2026-10-19", updated_at: "2026-10-20" });
const label = (text: string) => document.body.querySelector<HTMLElement>(`[aria-label="${text}"]`)!;
const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
async function mount(open = true) { await act(async () => root.render(<AddToCanvasDialog item={item} open={open} onOpenChange={close} />)); }
async function click(text: string) { await act(async () => button(text).click()); }
function savedTarget() { return { canvasId: "canvas", boardId: doc.boards[1].id, regionId: doc.boards[1].regions[0].id }; }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  doc = { schemaVersion: 2, boards: [createBoardShape({ x: 0, y: 0 }), createBoardShape({ x: 6000, y: 7000 })], freeItems: [] };
  doc.boards[0].name = "第一页"; doc.boards[1].name = "第二页"; doc.boards[1].regions[0].name = "证据";
  vi.mocked(listCanvases).mockResolvedValue([row()]);
  vi.mocked(getCanvas).mockImplementation(async () => ({ ok: true, row: row() }));
  vi.mocked(patchCanvas).mockResolvedValue({ ok: true, revision: 5, updated_at: "2026-10-20" });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("restores and summarizes the exact second-page target, one PATCH, remembers the actual focus, and links to the new card", async () => {
  rememberCanvasAddTarget("alice", savedTarget());
  await mount();
  expect(label("选择画布").textContent).toBe("研究画布");
  expect(label("选择页面").textContent).toBe("第二页");
  expect(label("选择区块").textContent).toBe("证据");
  expect(document.body.textContent).toContain("研究画布 › 第二页 › 证据 末尾");
  expect(getCanvas).toHaveBeenCalledTimes(1); // regions and duplicate detection use the same snapshot
  await click("添加");
  expect(patchCanvas).toHaveBeenCalledTimes(1);
  const payload = vi.mocked(patchCanvas).mock.calls[0][1];
  expect(payload.expectedRevision).toBe(4);
  expect(payload.content!.boards[0]).toEqual(doc.boards[0]);
  const blocks = payload.content!.boards[1].regions[0].sections.at(-1)!.columns[0].blocks;
  expect(blocks[0].type).toBe("materialCard");
  expect(readCanvasAddTarget("alice")).toEqual(savedTarget());
  const feedback = vi.mocked(toast).mock.calls.at(-1)![0];
  expect(feedback.title).toBe("已添加到画布");
  expect((feedback.description as React.ReactElement).props.href).toBe(`/canvas/canvas?focus=${blocks[0].id}`);
  expect(close).toHaveBeenCalledWith(false);
});
it("reopens with the newly created region and shows a nonblocking duplicate notice", async () => {
  rememberCanvasAddTarget("alice", { ...savedTarget(), regionId: "removed" });
  await mount();
  expect(label("选择区块").textContent).toBe("追加新区块");
  await click("添加");
  doc = vi.mocked(patchCanvas).mock.calls[0][1].content!;
  const remembered = readCanvasAddTarget("alice")!;
  expect(remembered.regionId).not.toBe(NEW_REGION);
  await mount(false); await mount();
  expect(label("选择页面").textContent).toBe("第二页");
  expect(label("选择区块").textContent).toBe(doc.boards[1].regions.at(-1)!.name);
  expect(document.body.textContent).toContain("此画布已有这条资料的卡片");
  expect(button("添加").disabled).toBe(false);
});
it("silently falls back when the saved canvas or page no longer exists", async () => {
  rememberCanvasAddTarget("alice", { ...savedTarget(), canvasId: "deleted" });
  await mount(); expect(label("选择画布").textContent).toBe("新建画布");
  await mount(false);
  rememberCanvasAddTarget("alice", { ...savedTarget(), boardId: "deleted" });
  await mount(); expect(label("选择页面").textContent).toBe("第一页");
  expect(label("选择区块").textContent).toBe("追加新区块");
});
it("keeps list and page failures honest and independently retryable", async () => {
  rememberCanvasAddTarget("alice", savedTarget());
  vi.mocked(listCanvases).mockResolvedValueOnce(null);
  await mount();
  expect(document.body.querySelector("[role=alert]")?.textContent).toContain("画布列表加载失败");
  expect(label("选择画布")).toBeNull();
  vi.mocked(getCanvas).mockResolvedValueOnce({ ok: false, reason: "network" });
  await click("重试");
  expect(document.body.querySelector("[role=alert]")?.textContent).toContain("画布页面加载失败");
  expect(button("添加").disabled).toBe(true);
  await click("重试");
  expect(label("选择页面").textContent).toBe("第二页");
  expect(document.body.querySelector("[role=alert]")).toBeNull();
});
it("does not PATCH or remember success when the chosen page/region was deleted before submit", async () => {
  rememberCanvasAddTarget("alice", savedTarget()); await mount();
  vi.mocked(getCanvas).mockResolvedValueOnce({ ok: true, row: { ...row(), content: { ...doc, boards: [doc.boards[0]] } } });
  await click("添加");
  expect(patchCanvas).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: "目标页面或区块已不存在，请重新选择" }));
});
it("retains the dialog and remembered target on 409, with explicit conflict feedback", async () => {
  rememberCanvasAddTarget("alice", { ...savedTarget(), regionId: NEW_REGION }); await mount();
  vi.mocked(patchCanvas).mockResolvedValueOnce({ ok: false, reason: "conflict", currentRevision: 5 });
  await click("添加");
  expect(close).not.toHaveBeenCalled();
  expect(readCanvasAddTarget("alice")?.regionId).toBe(NEW_REGION);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "添加到画布失败", description: "画布已被其他改动更新，请重试" }));
});
it("Enter submits once, IME Enter does not, and picker Enter does not submit", async () => {
  rememberCanvasAddTarget("alice", savedTarget()); await mount();
  const dialog = document.body.querySelector<HTMLElement>("[role=dialog]")!;
  await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })); });
  expect(patchCanvas).not.toHaveBeenCalled();
  await act(async () => { label("选择画布").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(patchCanvas).not.toHaveBeenCalled();
  await act(async () => { dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(patchCanvas).toHaveBeenCalledTimes(1);
});
it("duplicate cards on a different page are visible without another canvas request", async () => {
  const sourceRef = { kind: "memo" as const, id: item.id, title: "资料标题", updatedAt: "2026-10-20" };
  doc = appendMaterialCardToRegion(doc, { boardId: doc.boards[0].id, title: "资料标题", text: "", sourceRef }).doc;
  rememberCanvasAddTarget("alice", savedTarget()); await mount();
  expect(document.body.textContent).toContain("此画布已有这条资料的卡片");
  expect(getCanvas).toHaveBeenCalledTimes(1);
  await click("添加"); expect(patchCanvas).toHaveBeenCalledTimes(1);
});
