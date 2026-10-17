// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteTreeItem } from "@/lib/notes/tree";
import { NOTE_TREE_LOAD_ERROR_MESSAGE } from "@/lib/notes/note-tree-load";
import { NoteMoveDialog } from "./note-move-dialog";

// jsdom 没有 PointerEvent，用 MouseEvent 做最小 polyfill（Radix Dialog 依赖）
if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

const other: NoteTreeItem = {
  id: "other-page",
  title: "候选页面",
  icon: "📄",
  parent_note_id: null,
  updated_at: "2026-10-17T00:00:00Z",
};
const current: NoteTreeItem = {
  id: "note-1",
  title: "当前笔记",
  icon: "📄",
  parent_note_id: null,
  updated_at: "2026-10-17T00:00:00Z",
};

describe("NoteMoveDialog 笔记树加载失败诚实展示", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  const render = (props: { loadError?: string | null; onRetry?: () => void; notes?: NoteTreeItem[] }) => {
    act(() => {
      root.render(
        createElement(NoteMoveDialog, {
          open: true,
          onOpenChange: () => {},
          noteId: "note-1",
          noteTitle: "当前笔记",
          currentParentId: null,
          notes: props.notes ?? [other, current],
          onConfirm: vi.fn().mockResolvedValue(undefined),
          ...(props.loadError !== undefined ? { loadError: props.loadError } : {}),
          ...(props.onRetry ? { onRetry: props.onRetry } : {}),
        })
      );
    });
  };

  it("无 loadError：无 alert，候选与顶层笔记选项照常（旧行为）", () => {
    render({});
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("候选页面");
    expect(document.body.textContent).toContain("顶层笔记（无父页面）");
  });

  it("loadError：候选列表上方出现 role=alert 提示「候选列表可能不完整」，选项照常显示", () => {
    render({ loadError: NOTE_TREE_LOAD_ERROR_MESSAGE });
    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("子页面加载失败，候选列表可能不完整");
    expect(document.body.textContent).toContain("顶层笔记（无父页面）");
    expect(document.body.textContent).toContain("候选页面");
  });

  it("loadError 且快照为空：alert 提示而非只剩「没有匹配的页面」", () => {
    render({ loadError: NOTE_TREE_LOAD_ERROR_MESSAGE, notes: [current] });
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("子页面加载失败，候选列表可能不完整");
  });

  it("点击「重试」调用 onRetry；未传 onRetry 时不渲染重试按钮", () => {
    const onRetry = vi.fn();
    render({ loadError: NOTE_TREE_LOAD_ERROR_MESSAGE, onRetry });
    const alert = document.querySelector('[role="alert"]');
    const retryButton = Array.from(alert!.querySelectorAll("button")).find(
      (b) => b.textContent === "重试"
    );
    expect(retryButton).toBeTruthy();
    act(() => retryButton!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("未传 onRetry 时 alert 内没有重试按钮", () => {
    render({ loadError: NOTE_TREE_LOAD_ERROR_MESSAGE });
    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.querySelector("button")).toBeNull();
  });
});
