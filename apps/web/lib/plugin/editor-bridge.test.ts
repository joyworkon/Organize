import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Editor } from "@tiptap/core";
import { createEditorBridge } from "./editor-bridge";
import { replaceBlock } from "@/components/editor/block-commands";

vi.mock("@/components/editor/block-commands", () => ({
  replaceBlock: vi.fn(),
}));

interface FakeEditorOptions {
  text?: string;
  nodeSize?: number;
  missing?: boolean;
}

/** 构造 bridge 所需的最小 editor stub（bridge 只触碰 nodeAt / chain） */
function makeFakeEditor({ text = "块文本", nodeSize = 10, missing = false }: FakeEditorOptions = {}) {
  const run = vi.fn();
  const insertContentAt = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContentAt }));
  const chain = vi.fn(() => ({ focus }));
  const nodeAt = vi.fn(() => (missing ? null : { textContent: text, nodeSize }));
  const editor = {
    state: { doc: { nodeAt } },
    chain,
  } as unknown as Editor;
  return { editor, nodeAt, insertContentAt, run };
}

describe("createEditorBridge", () => {
  beforeEach(() => {
    vi.mocked(replaceBlock).mockClear();
  });

  it("getBlockText 返回锁定 pos 处的块文本；块不存在时返回空串", () => {
    const { editor, nodeAt } = makeFakeEditor({ text: " hello " });
    const bridge = createEditorBridge(editor, 42);

    expect(bridge.getBlockText()).toBe(" hello ");
    expect(nodeAt).toHaveBeenCalledWith(42);

    const empty = createEditorBridge(makeFakeEditor({ missing: true }).editor, 1);
    expect(empty.getBlockText()).toBe("");
  });

  it("replaceBlock 委托给块命令实现（带入原文本、保留块 id 的逻辑由其实现负责）", () => {
    const { editor } = makeFakeEditor();
    const bridge = createEditorBridge(editor, 7);
    const content = { type: "heading", attrs: { level: 2 }, content: [] };

    bridge.replaceBlock(content);

    expect(replaceBlock).toHaveBeenCalledWith(editor, 7, content);
  });

  it("insertAfter 在当前块之后插入内容", () => {
    const { editor, insertContentAt, run } = makeFakeEditor({ nodeSize: 15 });
    const bridge = createEditorBridge(editor, 3);
    const content = { type: "paragraph", content: [{ type: "text", text: "新段落" }] };

    bridge.insertAfter(content);

    expect(insertContentAt).toHaveBeenCalledWith(18, content);
    expect(run).toHaveBeenCalled();
  });

  it("insertAfter 块不存在时不动作", () => {
    const { editor, insertContentAt } = makeFakeEditor({ missing: true });
    const bridge = createEditorBridge(editor, 3);

    bridge.insertAfter({ type: "paragraph" });

    expect(insertContentAt).not.toHaveBeenCalled();
  });
});
