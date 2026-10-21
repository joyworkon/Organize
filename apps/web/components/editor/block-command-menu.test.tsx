// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiAvailability } from "@/hooks/use-ai-availability";
import { BLOCK_COMMANDS, executeNestedCommand, replaceBlock } from "./block-commands";
import { BlockCommandMenu, RECENT_GROUP_LABEL } from "./block-command-menu";
import { showMathEditor } from "./math-editor-dialog";
import { SLASH_RECENT_STORAGE_KEY } from "./slash-recent-commands";

vi.mock("./math-editor-dialog", () => ({ showMathEditor: vi.fn() }));
vi.mock("@/hooks/use-ai-availability", () => ({ useAiAvailability: vi.fn(() => false) }));
vi.mock("@/lib/plugin/slash-commands", () => {
  const entries: never[] = [];
  return { slashCommandRegistry: { subscribe: () => () => {}, list: () => entries } };
});
vi.mock("./block-commands", async () => {
  const { FileInput } = await import("@/components/icons");
  return {
    BLOCK_COMMANDS: [
      { id: "paragraph", label: "文本", description: "普通文字", category: "基本区块", icon: FileInput, run: vi.fn() },
      { id: "heading-1", label: "标题 1", category: "基本区块", icon: FileInput, shortcut: "#", run: vi.fn() },
      { id: "ai", label: "AI 整理", category: "AI", requiresAI: true, icon: FileInput, run: vi.fn() },
    ],
    commandMatches: (command: { label: string }, query: string) => command.label.includes(query),
    isCommandAvailableInContext: () => true,
    executeNestedCommand: vi.fn(() => "handled"),
    replaceBlock: vi.fn(),
  };
});

const POS = 7;

/** 假编辑器：块从 POS 开始，内容区自 POS+1 起；textBetween 按块文本切片，deleteRange 只记录 */
function createFakeEditor(blockText: string) {
  const dom = document.createElement("div");
  dom.tabIndex = 0;
  document.body.appendChild(dom);
  const deleteRange = vi.fn();
  const editor = {
    view: { dom },
    state: {
      doc: {
        nodeAt: () => ({ isTextblock: true, content: { size: blockText.length }, nodeSize: blockText.length + 2, textContent: blockText }),
        textBetween: (from: number, to: number) => blockText.slice(from - (POS + 1), to - (POS + 1)),
      },
    },
    chain: () => ({ deleteRange: (range: unknown) => { deleteRange(range); return { run: () => true }; } }),
  } as unknown as Editor;
  return { editor, dom, deleteRange };
}

describe("BlockCommandMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editor: Editor;
  const onClose = vi.fn();
  const range = { from: 8, to: 9 };

  function render(nested = false, overrides: Partial<Parameters<typeof BlockCommandMenu>[0]> = {}) {
    act(() => root.render(<BlockCommandMenu editor={editor} pos={POS} point={{ top: 100, left: 100 }} nested={nested} range={range} onClose={onClose} {...overrides} />));
  }
  function remount(overrides: Partial<Parameters<typeof BlockCommandMenu>[0]> = {}) {
    act(() => root.render(null));
    render(false, overrides);
  }
  function option(label: string) {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((node) => node.textContent?.startsWith(label))!;
  }
  function options() {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).map((node) => node.querySelector("strong")!.textContent);
  }
  function groupLabels() {
    return Array.from(document.querySelectorAll(".editor-menu-label")).map((node) => node.textContent);
  }
  function key(key: string) {
    act(() => document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  }
  function search(value: string) {
    const input = document.querySelector("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  /** 模拟 slash-command 扩展对 ↑/↓/Enter/Tab 的询问；返回 true 表示菜单消费了该键 */
  function slashKey(dom: HTMLElement, key: string) {
    let consumed = false;
    act(() => {
      consumed = !dom.dispatchEvent(new CustomEvent("organize-editor-action", { bubbles: true, cancelable: true, detail: { type: "slash-menu-key", key } }));
    });
    return consumed;
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(useAiAvailability).mockReturnValue(false);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    editor = createFakeEditor("/").editor;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.querySelectorAll("div[tabindex]").forEach((node) => node.remove());
    vi.unstubAllGlobals();
  });

  it("keeps click execution and shared focus rings on commands and close", () => {
    for (const button of document.querySelectorAll("button")) {
      expect(button.classList.contains("focus-visible:ring-2")).toBe(true);
    }
    act(() => option("标题 1").click());
    expect(BLOCK_COMMANDS[1].run).toHaveBeenCalledExactlyOnceWith(editor, POS);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps arrow selection and Enter execution with visible current state", () => {
    expect(option("文本").getAttribute("aria-current")).toBe("true");
    key("ArrowDown");
    expect(option("文本").getAttribute("aria-selected")).toBe("false");
    expect(option("标题 1").getAttribute("aria-selected")).toBe("true");
    expect(option("标题 1").classList.contains("bg-accent")).toBe(true);
    key("ArrowUp");
    key("Enter");
    expect(BLOCK_COMMANDS[0].run).toHaveBeenCalledExactlyOnceWith(editor, POS);
  });

  it("blocks unavailable AI clicks and Enter, and enables configured AI", () => {
    expect(option("AI 整理").disabled).toBe(true);
    expect(option("AI 整理").getAttribute("aria-disabled")).toBe("true");
    act(() => option("AI 整理").click());
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(BLOCK_COMMANDS[2].run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    vi.mocked(useAiAvailability).mockReturnValue(true);
    render();
    expect(option("AI 整理").disabled).toBe(false);
    act(() => option("AI 整理").click());
    expect(BLOCK_COMMANDS[2].run).toHaveBeenCalledExactlyOnceWith(editor, POS);
  });

  it("filters, clears via shared Button and retains Escape/close behavior", () => {
    search("标题");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    const clear = document.querySelector<HTMLButtonElement>('[aria-label="清空"]')!;
    expect(clear.classList.contains("focus-visible:ring-2")).toBe(true);
    act(() => clear.click());
    expect(document.querySelector("input")!.value).toBe("");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(3);
    key("Escape");
    expect(onClose).toHaveBeenCalledOnce();
    act(() => document.querySelector<HTMLButtonElement>(".editor-menu-close")!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("opens top-level math without deleting the trigger until save, and uses the mapped target", () => {
    const fake = createFakeEditor("/math保留");
    editor = fake.editor;
    const math = { ...BLOCK_COMMANDS[0], id: "math", label: "公式区块", run: vi.fn() };
    BLOCK_COMMANDS.push(math);
    try {
      remount({ clearTrigger: true, range: { from: POS + 1, to: POS + 6 } });
      act(() => option("公式区块").click());
      expect(fake.deleteRange).not.toHaveBeenCalled();
      expect(math.run).not.toHaveBeenCalled();
      expect(showMathEditor).toHaveBeenCalledWith(editor, expect.objectContaining({
        isBlock: true, latex: "保留", range: { from: POS, to: POS + 9 },
      }));
      const request = vi.mocked(showMathEditor).mock.calls.at(-1)![1];
      request.onSave!("x^2", { from: 11, to: 20 });
      expect(replaceBlock).toHaveBeenCalledWith(editor, 11, { type: "mathBlock", attrs: { latex: "x^2" } });
    } finally { BLOCK_COMMANDS.pop(); }
  });

  it("keeps nested commands on the existing dispatcher", () => {
    render(true);
    act(() => option("标题 1").click());
    expect(executeNestedCommand).toHaveBeenCalledExactlyOnceWith(editor, "heading-1", range);
    expect(BLOCK_COMMANDS[1].run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("⌘/ mode still focuses its own search box with the 筛选区块 label", () => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="筛选区块"]')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  describe("inline filter (triggered by '/')", () => {
    it("leaves focus in the editor, reads the query from the document and highlights the hit", () => {
      const fake = createFakeEditor("/标题");
      editor = fake.editor;
      fake.dom.focus();
      remount({ inline: true, clearTrigger: true, range: { from: 8, to: 11 }, query: "标题" });
      expect(document.querySelector("input")).toBeNull();
      expect(document.activeElement).toBe(fake.dom);
      expect(document.querySelector('[role="status"]')!.textContent).toBe("正在筛选：标题");
      expect(options()).toEqual(["标题 1"]);
      expect(option("标题 1").querySelector("strong mark")!.textContent).toBe("标题");
      expect(option("标题 1").querySelector("kbd")!.textContent).toBe("#");
      remount({ inline: true, clearTrigger: true, query: "" });
      expect(document.querySelector('[role="status"]')!.textContent).toContain("输入以筛选");
      expect(document.querySelector("mark")).toBeNull();
    });

    it("moves with ↑/↓, runs on Enter/Tab, consumes those keys and deletes only the '/query' text", () => {
      const fake = createFakeEditor("/标题已有文字");
      editor = fake.editor;
      remount({ inline: true, clearTrigger: true, range: { from: 8, to: 11 }, query: "" });
      expect(option("文本").getAttribute("aria-current")).toBe("true");
      expect(slashKey(fake.dom, "ArrowDown")).toBe(true);
      expect(option("标题 1").getAttribute("aria-selected")).toBe("true");
      expect(slashKey(fake.dom, "ArrowUp")).toBe(true);
      expect(option("文本").getAttribute("aria-selected")).toBe("true");
      expect(slashKey(fake.dom, "ArrowDown")).toBe(true);
      expect(slashKey(fake.dom, "Enter")).toBe(true);
      expect(fake.deleteRange).toHaveBeenCalledExactlyOnceWith({ from: 8, to: 11 });
      expect(BLOCK_COMMANDS[1].run).toHaveBeenCalledExactlyOnceWith(editor, POS);
      expect(onClose).toHaveBeenCalledOnce();

      // 刚执行过的「标题 1」会进入最近使用并排到最前；这里只验证 Tab，先清掉记录
      localStorage.clear();
      const tab = createFakeEditor("/");
      editor = tab.editor;
      remount({ inline: true, clearTrigger: true, range: { from: 8, to: 9 }, query: "" });
      expect(option("文本").getAttribute("aria-current")).toBe("true");
      expect(slashKey(tab.dom, "Tab")).toBe(true);
      expect(tab.deleteRange).toHaveBeenCalledExactlyOnceWith({ from: 8, to: 9 });
      expect(BLOCK_COMMANDS[0].run).toHaveBeenCalledExactlyOnceWith(editor, POS);
    });

    it("ignores key questions from another editor instance", () => {
      const fake = createFakeEditor("/");
      editor = fake.editor;
      remount({ inline: true, clearTrigger: true, query: "" });
      const other = document.createElement("div");
      document.body.appendChild(other);
      let consumed = false;
      act(() => {
        consumed = !other.dispatchEvent(new CustomEvent("organize-editor-action", { bubbles: true, cancelable: true, detail: { type: "slash-menu-key", key: "Enter" } }));
      });
      other.remove();
      expect(consumed).toBe(false);
      expect(BLOCK_COMMANDS[0].run).not.toHaveBeenCalled();
    });

    it("never deletes when the range does not hold slash text or lies outside the block", () => {
      const stale = createFakeEditor("已有文字");
      editor = stale.editor;
      remount({ inline: true, clearTrigger: true, range: { from: 8, to: 9 }, query: "" });
      expect(slashKey(stale.dom, "Enter")).toBe(true);
      expect(stale.deleteRange).not.toHaveBeenCalled();
      expect(BLOCK_COMMANDS[0].run).toHaveBeenCalledOnce();

      const outside = createFakeEditor("/");
      editor = outside.editor;
      remount({ inline: true, clearTrigger: true, range: { from: 8, to: 40 }, query: "" });
      act(() => option("文本").click());
      expect(outside.deleteRange).not.toHaveBeenCalled();
    });

    it("nested: refuses to run when the range text is not a slash trigger", () => {
      const fake = createFakeEditor("已有文字");
      editor = fake.editor;
      act(() => root.render(null));
      render(true, { inline: true, clearTrigger: true, range: { from: 8, to: 9 }, query: "" });
      act(() => option("标题 1").click());
      expect(executeNestedCommand).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("Escape and the close button keep the typed '/xxx' in the document", () => {
      const fake = createFakeEditor("/标题");
      editor = fake.editor;
      remount({ inline: true, clearTrigger: true, range: { from: 8, to: 11 }, query: "标题" });
      act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(onClose).toHaveBeenCalledOnce();
      act(() => document.querySelector<HTMLButtonElement>(".editor-menu-close")!.click());
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(fake.deleteRange).not.toHaveBeenCalled();
    });

    it("closes by itself after two more characters without a match and does not consume keys meanwhile", () => {
      const fake = createFakeEditor("/zz");
      editor = fake.editor;
      remount({ inline: true, clearTrigger: true, range: { from: 8, to: 11 }, query: "zz" });
      expect(document.querySelector(".editor-menu-empty")!.textContent).toBe("没有匹配的区块");
      expect(slashKey(fake.dom, "Enter")).toBe(false);
      expect(slashKey(fake.dom, "ArrowDown")).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
      render(false, { inline: true, clearTrigger: true, range: { from: 8, to: 12 }, query: "zzz" });
      expect(onClose).not.toHaveBeenCalled();
      render(false, { inline: true, clearTrigger: true, range: { from: 8, to: 13 }, query: "zzzz" });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("a match after a miss resets the auto-close counter", () => {
      const fake = createFakeEditor("/zz");
      editor = fake.editor;
      remount({ inline: true, clearTrigger: true, range: { from: 8, to: 11 }, query: "zz" });
      render(false, { inline: true, clearTrigger: true, range: { from: 8, to: 10 }, query: "标" });
      render(false, { inline: true, clearTrigger: true, range: { from: 8, to: 11 }, query: "标z" });
      render(false, { inline: true, clearTrigger: true, range: { from: 8, to: 12 }, query: "标zz" });
      expect(onClose).not.toHaveBeenCalled();
      render(false, { inline: true, clearTrigger: true, range: { from: 8, to: 13 }, query: "标zzz" });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("recently used", () => {
    it("shows executed commands first on the next open, deduped from their category and skipping unavailable AI", () => {
      expect(groupLabels()).toEqual(["基本区块", "AI"]);
      act(() => option("标题 1").click());
      expect(JSON.parse(localStorage.getItem(SLASH_RECENT_STORAGE_KEY)!)).toEqual(["heading-1"]);
      localStorage.setItem(SLASH_RECENT_STORAGE_KEY, JSON.stringify(["ai", "heading-1"]));
      remount();
      expect(groupLabels()).toEqual([RECENT_GROUP_LABEL, "基本区块", "AI"]);
      expect(options()).toEqual(["标题 1", "文本", "AI 整理"]);
      expect(option("标题 1").getAttribute("aria-current")).toBe("true");
      key("ArrowDown");
      expect(option("文本").getAttribute("aria-selected")).toBe("true");
      vi.mocked(useAiAvailability).mockReturnValue(true);
      remount();
      expect(options()).toEqual(["AI 整理", "标题 1", "文本"]);
    });

    it("hides the group while filtering and in inline mode once a query exists", () => {
      localStorage.setItem(SLASH_RECENT_STORAGE_KEY, JSON.stringify(["heading-1"]));
      remount();
      expect(groupLabels()[0]).toBe(RECENT_GROUP_LABEL);
      search("标");
      expect(groupLabels()).toEqual(["基本区块"]);
      const fake = createFakeEditor("/");
      editor = fake.editor;
      remount({ inline: true, clearTrigger: true, query: "" });
      expect(groupLabels()[0]).toBe(RECENT_GROUP_LABEL);
      render(false, { inline: true, clearTrigger: true, query: "文" });
      expect(groupLabels()).toEqual(["基本区块"]);
    });

    it("does not record commands that were not executed", () => {
      act(() => option("AI 整理").click());
      expect(localStorage.getItem(SLASH_RECENT_STORAGE_KEY)).toBeNull();
    });
  });
});
