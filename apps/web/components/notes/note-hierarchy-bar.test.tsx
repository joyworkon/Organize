// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteTreeItem } from "@/lib/notes/tree";
import { NOTE_TREE_LOAD_ERROR_MESSAGE } from "@/lib/notes/note-tree-load";
import { NoteHierarchyBar } from "./note-hierarchy-bar";

// jsdom 没有 PointerEvent，用 MouseEvent 做最小 polyfill（Radix 弹层依赖）
if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

const parent: NoteTreeItem = {
  id: "parent-1",
  title: "父页面",
  icon: "📁",
  parent_note_id: null,
  updated_at: "2026-10-17T00:00:00Z",
};
const current: NoteTreeItem = {
  id: "note-1",
  title: "当前笔记",
  icon: "📄",
  parent_note_id: "parent-1",
  updated_at: "2026-10-17T00:00:00Z",
};

describe("NoteHierarchyBar 笔记树加载失败诚实展示", () => {
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

  const render = (props: {
    notes: NoteTreeItem[];
    parentNoteId?: string | null;
    loadError?: string | null;
    onRetry?: () => void;
  }) => {
    act(() => {
      root.render(
        createElement(NoteHierarchyBar, {
          noteId: "note-1",
          title: "当前笔记",
          icon: "📄",
          parentNoteId: props.parentNoteId ?? null,
          notes: props.notes,
          onParentChange: () => {},
          ...(props.loadError !== undefined ? { loadError: props.loadError } : {}),
          ...(props.onRetry ? { onRetry: props.onRetry } : {}),
        })
      );
    });
  };

  const openParentPopover = () => {
    const trigger = container.querySelector("button.note-hierarchy-move") as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    act(() => trigger!.click());
  };

  it("无 loadError 且有父链：显示父页面链接，无占位段（旧行为）", () => {
    render({ notes: [parent, current], parentNoteId: "parent-1" });
    expect(container.textContent).toContain("父页面");
    expect(container.querySelector(".note-hierarchy-placeholder")).toBeNull();
  });

  it("无 loadError 且无父页面：无占位段（旧行为）", () => {
    render({ notes: [current], parentNoteId: null });
    expect(container.querySelector(".note-hierarchy-placeholder")).toBeNull();
    expect(container.textContent).toContain("当前笔记");
  });

  it("loadError + 有父页面 + 快照为空：插入「上级页面」占位段，不冒充顶层笔记", () => {
    render({ notes: [], parentNoteId: "parent-1", loadError: NOTE_TREE_LOAD_ERROR_MESSAGE });
    const placeholder = container.querySelector(".note-hierarchy-placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain("上级页面");
    expect(placeholder?.getAttribute("title")).toBe("上级页面加载失败");
    expect(placeholder?.getAttribute("aria-label")).toBe("上级页面加载失败");
  });

  it("loadError 但祖先存在（上次快照）：父链照常显示，无占位段", () => {
    render({ notes: [parent, current], parentNoteId: "parent-1", loadError: NOTE_TREE_LOAD_ERROR_MESSAGE });
    expect(container.textContent).toContain("父页面");
    expect(container.querySelector(".note-hierarchy-placeholder")).toBeNull();
  });

  it("loadError 但确实无父页面：无占位段", () => {
    render({ notes: [], parentNoteId: null, loadError: NOTE_TREE_LOAD_ERROR_MESSAGE });
    expect(container.querySelector(".note-hierarchy-placeholder")).toBeNull();
  });

  it("弹层：loadError 时搜索框下方有 role=alert 提示「候选列表可能不完整」与「重试」，顶层笔记选项照常", () => {
    const onRetry = vi.fn();
    render({
      notes: [current],
      parentNoteId: "parent-1",
      loadError: NOTE_TREE_LOAD_ERROR_MESSAGE,
      onRetry,
    });
    openParentPopover();
    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("子页面加载失败，候选列表可能不完整");
    expect(alert?.textContent).toContain("重试");
    expect(document.body.textContent).toContain("顶层笔记");
    const retryButton = Array.from(alert!.querySelectorAll("button")).find(
      (b) => b.textContent === "重试"
    );
    expect(retryButton).toBeTruthy();
    act(() => retryButton!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("弹层：无 loadError 时无 alert（旧行为）", () => {
    render({ notes: [current], parentNoteId: null });
    openParentPopover();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain("顶层笔记");
  });
});
