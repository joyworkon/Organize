// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasListItem } from "@/lib/canvas/repository";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), patch: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), restore: vi.fn(), prompt: vi.fn(), push: vi.fn(), toast: vi.fn(), dismiss: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/canvas/repository", () => ({ listCanvases: mocks.list, getCanvas: mocks.get, patchCanvas: mocks.patch, duplicateCanvas: mocks.duplicate, deleteCanvas: mocks.remove, createCanvas: vi.fn() }));
vi.mock("@/lib/trash/client", () => ({ mutateTrash: mocks.restore }));
vi.mock("@/components/ui/prompt-dialog", () => ({ showPrompt: mocks.prompt }));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
import CanvasListPage from "@/app/(main)/canvas/page";

let container: HTMLDivElement;
let root: Root;
const items: CanvasListItem[] = [
  { id: "a", title: "Alpha", created_at: "2026-01-03", updated_at: "2026-02-01", summary: { pages: 1, blocks: 2, excerpt: "秋天的灵感", shapes: [] } },
  { id: "b", title: "Beta", created_at: "2026-01-01", updated_at: "2026-02-03" },
];
async function mount() { await act(async () => { root.render(<CanvasListPage />); }); }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function button(label: string) { return Array.from(document.querySelectorAll("button")).find((e) => e.getAttribute("aria-label") === label || e.textContent === label)!; }
async function menu(label: string, item: string) {
  const trigger = button(label);
  await act(async () => { trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })); });
  const entry = Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')).find((e) => e.textContent === item);
  expect(entry, `菜单项 ${item}`).toBeTruthy();
  await click(entry!);
}
async function search(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function titles() { return Array.from(container.querySelectorAll(".canvas-list-info > span:first-child")).map((e) => e.textContent); }

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  localStorage.clear();
  mocks.list.mockResolvedValue(items);
  mocks.toast.mockReturnValue({ dismiss: mocks.dismiss });
  mocks.get.mockResolvedValue({ ok: true, row: { id: "a", revision: 1 } });
  mocks.patch.mockResolvedValue({ ok: true });
  mocks.duplicate.mockResolvedValue({ ok: true });
  mocks.remove.mockResolvedValue({ ok: true });
  mocks.restore.mockResolvedValue(1);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("canvas list page", () => {
  it("标题/摘要即时搜索、无结果清除搜索、旧响应无摘要降级", async () => {
    await mount();
    expect(titles()).toEqual(["Beta", "Alpha"]);
    expect(container.textContent).toContain("暂无预览");
    await search("秋天"); expect(titles()).toEqual(["Alpha"]);
    await search("beta"); expect(titles()).toEqual(["Beta"]);
    await search("missing"); expect(container.textContent).toContain("没有匹配的画布");
    await click(button("清除搜索")); expect(titles()).toHaveLength(2);
  });
  it("排序菜单即时生效且保存偏好；重载读取偏好", async () => {
    await mount();
    await menu("画布排序：最近修改", "最近创建");
    expect(titles()).toEqual(["Alpha", "Beta"]);
    expect(localStorage.getItem("organize-canvas-list-sort")).toBe("created_at");
    await menu("画布排序：最近创建", "标题");
    expect(localStorage.getItem("organize-canvas-list-sort")).toBe("title");
    act(() => root.unmount()); root = createRoot(container);
    await mount(); expect(button("画布排序：标题")).toBeTruthy();
  });
  it("卡片菜单可打开/重命名/复制，菜单动作不会意外打开卡片", async () => {
    await mount();
    await menu("画布操作：Alpha", "打开"); expect(mocks.push).toHaveBeenCalledWith("/canvas/a");
    mocks.push.mockClear(); mocks.prompt.mockResolvedValue("新名");
    await menu("画布操作：Alpha", "重命名");
    expect(mocks.patch).toHaveBeenCalledWith("a", { title: "新名", expectedRevision: 1 });
    await menu("画布操作：Alpha", "创建副本"); expect(mocks.duplicate).toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    await click(container.querySelector(".canvas-list-open")!); expect(mocks.push).toHaveBeenCalledWith("/canvas/b");
  });
  it("删除后 toast 撤销调用恢复接口并刷新；失败不宣称恢复", async () => {
    await mount();
    await menu("画布操作：Alpha", "移入垃圾箱");
    expect(mocks.remove).toHaveBeenCalledWith("a");
    const notice = mocks.toast.mock.calls.find(([arg]) => arg.title === "已移入垃圾箱")![0];
    await act(async () => { notice.action.props.onClick(); });
    expect(mocks.restore).toHaveBeenCalledWith("canvas_document", ["a"], "restore");
    expect(mocks.toast).toHaveBeenCalledWith({ title: "已恢复画布" });
    mocks.restore.mockResolvedValue(0);
    await act(async () => { notice.action.props.onClick(); });
    expect(mocks.toast).toHaveBeenLastCalledWith({ title: "恢复失败，请在垃圾箱重试", variant: "destructive" });
  });
  it("加载骨架、失败重试与空库状态分别呈现", async () => {
    mocks.list.mockReturnValue(new Promise(() => {}));
    await mount(); expect(container.querySelector('[aria-label="正在加载画布"]')).toBeTruthy();
    act(() => root.unmount()); root = createRoot(container);
    mocks.list.mockResolvedValue(null);
    await mount(); expect(container.textContent).toContain("画布列表加载失败");
    expect(container.textContent).not.toContain("还没有画布");
    mocks.list.mockResolvedValue([]);
    await click(button("重试")); expect(container.textContent).toContain("还没有画布");
  });
  it("刷新失败保留已有卡片和行内错误", async () => {
    await mount(); mocks.list.mockResolvedValue(null);
    await menu("画布操作：Alpha", "创建副本");
    expect(titles()).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("画布列表加载失败");
  });
});
