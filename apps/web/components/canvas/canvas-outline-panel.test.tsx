// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBoardSkeleton, renameBoard } from "@/lib/canvas/commands";
import { emptyDoc } from "@/lib/canvas/model";
import { showConfirm } from "@/components/ui/prompt-dialog";
import { CanvasOutlineTree } from "./canvas-outline-panel";
import { CanvasPropertyBar } from "./canvas-property-bar";
import { CanvasBoardView } from "./canvas-board";
import { createCanvasStore, type CanvasStore } from "./canvas-store";
import { computeScene } from "@/lib/canvas/layout";
import { commitBoardDuplicate } from "./canvas-board-actions";

vi.mock("@/components/ui/prompt-dialog", () => ({ showConfirm: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
let store: CanvasStore;
const reveal = vi.fn();
const fit = vi.fn();
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label);
  if (!found) throw new Error(`找不到 ${label}`);
  return found;
}
function click(label: string, type = "click") {
  act(() => button(label).dispatchEvent(new MouseEvent(type, { bubbles: true })));
}
function mountTree() {
  act(() => root.render(<CanvasOutlineTree store={store} onReveal={reveal} onFit={fit} />));
}
function inputName(value: string) {
  const input = container.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
function key(input: HTMLInputElement, key: string, extra = {}) {
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra })));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  const doc = createBoardSkeleton(emptyDoc(), { variant: "landing" }).doc;
  store = createCanvasStore({ doc: renameBoard(doc, { boardId: doc.boards[0].id, name: "方案" }).doc });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("单击只定位；名称双击选中、fit 并可就地改名，Enter 只提交一次", () => {
  mountTree(); click("页面：方案");
  expect(reveal).toHaveBeenCalledWith({ kind: "board", boardId: store.getState().doc.boards[0].id });
  expect(fit).not.toHaveBeenCalled();
  click("页面：方案", "dblclick");
  expect(fit).toHaveBeenCalledWith(store.getState().selection);
  key(inputName("  新方案  "), "Enter");
  expect(store.getState().doc.boards[0].name).toBe("新方案");
  act(() => store.getState().undo());
  expect(store.getState().doc.boards[0].name).toBe("方案");
  expect(store.getState().history.canUndo).toBe(false);
});

it("铅笔改名 Esc 取消、IME Enter 不提交，空白名归一", () => {
  mountTree(); click("重命名页面 方案");
  key(inputName("取消"), "Escape");
  expect(store.getState().doc.boards[0].name).toBe("方案");
  click("重命名页面 方案"); const input = inputName("  ");
  key(input, "Enter", { isComposing: true });
  expect(container.querySelector("input")).not.toBeNull();
  expect(store.getState().doc.boards[0].name).toBe("方案");
  key(input, "Enter");
  expect(store.getState().doc.boards[0].name).toBeUndefined();
  expect(button("页面：页面 1")).toBeDefined();
});

it("大纲复制整页后选中并定位新页，一次撤销还原全部区块与选区", () => {
  mountTree(); click("页面：方案"); const before = store.getState().doc;
  click("复制页面 方案"); const copy = store.getState().doc.boards[1];
  expect(copy.regions).toHaveLength(3);
  expect(store.getState().selection).toEqual({ kind: "board", boardId: copy.id });
  expect(reveal).toHaveBeenLastCalledWith({ kind: "board", boardId: copy.id });
  act(() => store.getState().undo());
  expect(store.getState().doc).toEqual(before);
  expect(store.getState().history.canUndo).toBe(false);
  expect(store.getState().selection).toEqual({ kind: "board", boardId: before.boards[0].id });
});

it("删除确认说明整页影响，取消保留、确认删除，可撤销", async () => {
  mountTree(); vi.mocked(showConfirm).mockResolvedValueOnce(false);
  await act(async () => { button("删除页面 方案").click(); });
  expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true, description: expect.stringContaining("全部区块") }));
  expect(store.getState().doc.boards).toHaveLength(1);
  vi.mocked(showConfirm).mockResolvedValueOnce(true);
  await act(async () => { button("删除页面 方案").click(); });
  expect(store.getState().doc.boards).toHaveLength(0);
  act(() => store.getState().undo()); expect(store.getState().doc.boards[0].regions).toHaveLength(3);
});

it("确认等待期间失去写权限，确认后不删除", async () => {
  let resolve!: (ok: boolean) => void;
  vi.mocked(showConfirm).mockReturnValue(new Promise((done) => { resolve = done; }));
  mountTree(); click("删除页面 方案");
  act(() => store.setState({ readOnly: true }));
  await act(async () => { resolve(true); });
  expect(store.getState().doc.boards).toHaveLength(1);
});

it.each(["readOnly", "previewMode"] as const)("%s 隐藏写动作，仍可双击 fit", (mode) => {
  store.setState({ [mode]: true }); mountTree();
  expect(container.querySelector('[aria-label^="复制页面"]')).toBeNull();
  expect(container.querySelector('[aria-label^="删除页面"]')).toBeNull();
  expect(container.querySelector('[aria-label^="重命名"]')).toBeNull();
  expect(container.querySelector('[aria-label^="上移页面"]')).toBeNull();
  expect(container.querySelector('[aria-label^="下移页面"]')).toBeNull();
  click("页面：方案", "dblclick");
  expect(fit).toHaveBeenCalled(); expect(container.querySelector("input")).toBeNull();
  expect(commitBoardDuplicate(store, store.getState().doc.boards[0].id)).toBeNull();
  expect(store.getState().doc.boards).toHaveLength(1);
});

it("三页大纲排序选中移动页、保留位置，每次移动独立撤销/重做，首尾禁用并说明", () => {
  let doc = store.getState().doc;
  doc = createBoardSkeleton(doc, { variant: "blank", at: { x: 900, y: 300 } }).doc;
  doc = renameBoard(doc, { boardId: doc.boards[1].id, name: "第二页" }).doc;
  doc = createBoardSkeleton(doc, { variant: "blank", at: { x: -800, y: -300 } }).doc;
  doc = renameBoard(doc, { boardId: doc.boards[2].id, name: "第三页" }).doc;
  store = createCanvasStore({ doc });
  mountTree();
  const [a, b, c] = doc.boards;
  expect(button("上移页面 方案").disabled).toBe(true);
  expect(button("上移页面 方案").title).toContain("第一个页面");
  expect(button("下移页面 第三页").disabled).toBe(true);
  expect(button("下移页面 第三页").title).toContain("最后一个页面");
  click("页面：方案");
  click("上移页面 第三页");
  expect(store.getState().doc.boards).toEqual([a, c, b]);
  expect(store.getState().selection).toEqual({ kind: "board", boardId: c.id });
  expect(store.getState().history.peekUndoLabel()).toBe("上移页面");
  click("上移页面 第三页");
  expect(store.getState().doc.boards).toEqual([c, a, b]);
  expect([...container.querySelectorAll('.is-board .canvas-outline-name')].map((el) => el.textContent)).toEqual(["第三页", "方案", "第二页"]);
  expect(button("上移页面 第三页").disabled).toBe(true);
  act(() => store.getState().undo());
  expect(store.getState().doc.boards).toEqual([a, c, b]);
  act(() => store.getState().undo());
  expect(store.getState().doc).toEqual(doc);
  expect(store.getState().selection).toEqual({ kind: "board", boardId: a.id });
  expect(store.getState().history.canUndo).toBe(false);
  act(() => store.getState().redo());
  act(() => store.getState().redo());
  expect(store.getState().doc.boards).toEqual([c, a, b]);
  expect(store.getState().selection).toEqual({ kind: "board", boardId: c.id });
  click("下移页面 第三页");
  expect(store.getState().doc.boards).toEqual([a, c, b]);
  expect(store.getState().history.peekUndoLabel()).toBe("下移页面");
});

it("属性栏与悬停条都有可撤销的整页复制入口", () => {
  const board = store.getState().doc.boards[0];
  store.getState().select({ kind: "board", boardId: board.id });
  act(() => root.render(<CanvasPropertyBar store={store} measurer={{ measure: () => 30 }} />));
  click("复制页面"); expect(store.getState().doc.boards).toHaveLength(2);
  act(() => store.getState().undo());
  act(() => root.render(<CanvasBoardView board={board} sceneBoard={computeScene(store.getState().doc, () => 30).boards[0]}
    store={store} zoom={1} interactive userId="test" assetUrls={{}} selectedBoard selectedRegion={null}
    selectedBlockIds={[]} editingBlockId={null} sourceStatuses={new Map()} />));
  click("复制页面"); expect(store.getState().doc.boards).toHaveLength(2);
  act(() => store.getState().undo()); expect(store.getState().doc.boards).toHaveLength(1);
});
