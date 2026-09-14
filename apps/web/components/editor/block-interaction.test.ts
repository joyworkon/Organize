// @vitest-environment jsdom
/**
 * B04：块键盘分派工厂（createBlockKeydownHandlers）单测。
 * 从 tiptap-editor 内联提出时的行为等价钉子：
 * - IME 组合态（isComposing / keyCode 229）必须放行（返回 false，不碰状态）
 * - 标题行尾回车插入后续段落（不是续建同级标题）
 * - ⌘/ 仅顶层块（depth===1）打开块命令菜单，嵌套块忽略
 * - ⌘F / Ctrl+F 打开页内搜索
 * - 其余按键一律放行
 *
 * TextSelection.near 需要完整 ProseMirror doc 结构，与被测分派逻辑无关——mock 掉。
 */
import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@tiptap/pm/view";

vi.mock("@tiptap/pm/state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tiptap/pm/state")>()),
  TextSelection: { near: vi.fn(() => "NEAR_SEL") },
}));

const { createBlockKeydownHandlers } = await import("./block-interaction");

type Pos = {
  depth: number;
  parentOffset: number;
  parent: { type: { name: string }; content: { size: number } };
  after: (depth: number) => number;
  before: (depth: number) => number;
  pos: number;
};

function makeView(opts: {
  depth?: number;
  parentType?: string;
  parentOffset?: number;
  contentSize?: number;
  coords?: { left: number; top: number; bottom: number };
} = {}) {
  const calls: { dispatched: number; commandMenu: Array<{ pos: number; point: unknown }>; search: number } = {
    dispatched: 0,
    commandMenu: [],
    search: 0,
  };
  const from: Pos = {
    depth: opts.depth ?? 1,
    parentOffset: opts.parentOffset ?? 5,
    parent: { type: { name: opts.parentType ?? "paragraph" }, content: { size: opts.contentSize ?? 10 } },
    after: (depth: number) => 100 + depth,
    before: () => 40,
    pos: 42,
  };
  const makeTr = () => {
    const tr: Record<string, unknown> = {};
    tr.doc = { resolve: () => ({}) };
    tr.setSelection = () => tr;
    tr.scrollIntoView = () => tr;
    tr.setMeta = () => tr;
    return tr;
  };
  const stateTr = makeTr();
  (stateTr as { insert: unknown }).insert = () => makeTr();
  const view = {
    state: {
      selection: { $from: from, empty: true, from: 42, to: 42 },
      tr: stateTr,
      schema: {
        nodes: {
          paragraph: { create: () => ({ type: "paragraph" }) },
        },
      },
    },
    coordsAtPos: () => opts.coords ?? { left: 30, top: 40, bottom: 60 },
    dispatch: () => {
      calls.dispatched += 1;
    },
  } as unknown as EditorView;

  const handlers = createBlockKeydownHandlers({
    onOpenCommandMenu: (pos, point) => calls.commandMenu.push({ pos, point }),
    onOpenSearchDialog: () => {
      calls.search += 1;
    },
  });
  return { view, handlers, calls };
}

function keyEvent(patch: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "Enter",
    isComposing: false,
    keyCode: 0,
    metaKey: false,
    ctrlKey: false,
    preventDefault: vi.fn(),
    ...patch,
  } as unknown as KeyboardEvent;
}

describe("createBlockKeydownHandlers（B04 自 tiptap-editor 提出时的行为等价）", () => {
  it("IME 组合态放行：isComposing / keyCode 229 不消费、不碰状态", () => {
    const { view, handlers, calls } = makeView();
    expect(handlers(view, keyEvent({ isComposing: true }))).toBe(false);
    expect(handlers(view, keyEvent({ keyCode: 229 }))).toBe(false);
    expect(calls.dispatched).toBe(0);
    expect(calls.commandMenu).toHaveLength(0);
    expect(calls.search).toBe(0);
  });

  it("标题行尾回车：插入段落并消费事件", () => {
    const { view, handlers, calls } = makeView({ parentType: "heading", parentOffset: 10, contentSize: 10 });
    const event = keyEvent();
    expect(handlers(view, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(calls.dispatched).toBe(1);
  });

  it("标题非行尾回车放行（默认行为续建标题由 TipTap 处理）", () => {
    const { view, handlers, calls } = makeView({ parentType: "heading", parentOffset: 3, contentSize: 10 });
    expect(handlers(view, keyEvent())).toBe(false);
    expect(calls.dispatched).toBe(0);
  });

  it("⌘/ 顶层块打开块命令菜单，锚点坐标含 12px 左缘下限", () => {
    const { view, handlers, calls } = makeView({ depth: 1, coords: { left: 4, top: 40, bottom: 60 } });
    expect(handlers(view, keyEvent({ key: "/", metaKey: true }))).toBe(true);
    expect(calls.commandMenu).toEqual([
      { pos: expect.any(Number), point: { left: 12, top: 68, anchorTop: 40 } },
    ]);
  });

  it("Ctrl+/ 等价；嵌套块（depth>1）忽略菜单快捷键", () => {
    const { view, handlers, calls } = makeView({ depth: 1 });
    expect(handlers(view, keyEvent({ key: "/", ctrlKey: true }))).toBe(true);
    expect(calls.commandMenu).toHaveLength(1);

    const nested = makeView({ depth: 2 });
    expect(nested.handlers(nested.view, keyEvent({ key: "/", metaKey: true }))).toBe(false);
    expect(nested.calls.commandMenu).toHaveLength(0);
  });

  it("⌘F / Ctrl+F 打开页内搜索", () => {
    const { view, handlers, calls } = makeView();
    expect(handlers(view, keyEvent({ key: "f", metaKey: true }))).toBe(true);
    expect(handlers(view, keyEvent({ key: "F", ctrlKey: true }))).toBe(true);
    expect(calls.search).toBe(2);
  });

  it("无关按键一律放行", () => {
    const { view, handlers, calls } = makeView();
    expect(handlers(view, keyEvent({ key: "a", metaKey: true }))).toBe(false);
    expect(handlers(view, keyEvent({ key: "ArrowDown" }))).toBe(false);
    expect(calls.dispatched).toBe(0);
    expect(calls.commandMenu).toHaveLength(0);
    expect(calls.search).toBe(0);
  });
});
