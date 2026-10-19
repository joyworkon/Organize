// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiAvailability } from "@/hooks/use-ai-availability";
import { BLOCK_COMMANDS, executeNestedCommand } from "./block-commands";
import { BlockCommandMenu } from "./block-command-menu";

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
      { id: "heading-1", label: "标题 1", category: "基本区块", icon: FileInput, run: vi.fn() },
      { id: "ai", label: "AI 整理", category: "AI", requiresAI: true, icon: FileInput, run: vi.fn() },
    ],
    commandMatches: (command: { label: string }, query: string) => command.label.includes(query),
    isCommandAvailableInContext: () => true,
    executeNestedCommand: vi.fn(() => "handled"),
  };
});

describe("BlockCommandMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editor: Editor;
  const onClose = vi.fn();
  const range = { from: 8, to: 9 };

  function render(nested = false) {
    act(() => root.render(<BlockCommandMenu editor={editor} pos={7} point={{ top: 100, left: 100 }} nested={nested} range={range} onClose={onClose} />));
  }
  function option(label: string) {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((node) => node.textContent?.startsWith(label))!;
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

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(useAiAvailability).mockReturnValue(false);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    editor = {} as Editor;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps click execution and shared focus rings on commands and close", () => {
    for (const button of document.querySelectorAll("button")) {
      expect(button.classList.contains("focus-visible:ring-2")).toBe(true);
    }
    act(() => option("标题 1").click());
    expect(BLOCK_COMMANDS[1].run).toHaveBeenCalledExactlyOnceWith(editor, 7);
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
    expect(BLOCK_COMMANDS[0].run).toHaveBeenCalledExactlyOnceWith(editor, 7);
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
    expect(BLOCK_COMMANDS[2].run).toHaveBeenCalledExactlyOnceWith(editor, 7);
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

  it("keeps nested commands on the existing dispatcher", () => {
    render(true);
    act(() => option("标题 1").click());
    expect(executeNestedCommand).toHaveBeenCalledExactlyOnceWith(editor, "heading-1", range);
    expect(BLOCK_COMMANDS[1].run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
