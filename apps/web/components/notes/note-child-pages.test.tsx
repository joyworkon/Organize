// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteTreeItem } from "@/lib/notes/tree";
import { NOTE_TREE_LOAD_ERROR_MESSAGE } from "@/lib/notes/note-tree-load";
import { NoteChildPages } from "./note-child-pages";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const childA: NoteTreeItem = {
  id: "child-a",
  title: "子页面甲",
  icon: "📄",
  parent_note_id: "note-1",
  updated_at: "2026-10-17T00:00:00Z",
};
const unrelated: NoteTreeItem = {
  id: "other",
  title: "别家的页面",
  icon: null,
  parent_note_id: "note-2",
  updated_at: "2026-10-17T00:00:00Z",
};

describe("NoteChildPages 加载失败诚实展示", () => {
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
  });

  const render = (props: { notes: NoteTreeItem[]; loadError?: string | null; onRetry?: () => void }) => {
    act(() => {
      root.render(
        createElement(NoteChildPages, {
          noteId: "note-1",
          notes: props.notes,
          ...(props.loadError !== undefined ? { loadError: props.loadError } : {}),
          ...(props.onRetry ? { onRetry: props.onRetry } : {}),
        })
      );
    });
  };

  it("无 loadError 且无子页面：仅渲染「新建子页面」，与旧行为一致", () => {
    render({ notes: [] });
    expect(container.textContent).toContain("新建子页面");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("loadError 且无旧列表：显示 alert 错误条与「重试」，不摆「新建子页面」冒充没有子页面", () => {
    render({ notes: [], loadError: NOTE_TREE_LOAD_ERROR_MESSAGE, onRetry: () => {} });
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("子页面加载失败");
    expect(alert?.textContent).toContain("重试");
    expect(container.textContent).not.toContain("新建子页面");
  });

  it("loadError 且有旧列表：照常显示列表，提示后缀「上次加载结果」", () => {
    render({ notes: [childA, unrelated], loadError: NOTE_TREE_LOAD_ERROR_MESSAGE, onRetry: () => {} });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("子页面加载失败，显示的是上次加载结果");
    expect(container.textContent).toContain("子页面甲");
    expect(container.textContent).not.toContain("别家的页面");
  });

  it("点击「重试」调用 onRetry", () => {
    const onRetry = vi.fn();
    render({ notes: [], loadError: NOTE_TREE_LOAD_ERROR_MESSAGE, onRetry });
    const retryButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "重试");
    expect(retryButton).toBeTruthy();
    act(() => retryButton!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
