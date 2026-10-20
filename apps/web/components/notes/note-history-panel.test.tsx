// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteHistoryPanel, type NoteVersionMeta } from "./note-history-panel";

const versions: NoteVersionMeta[] = [
  { id: "new", title: "最新稿", message: null, created_at: "2026-10-20T10:00:00.000Z" },
  { id: "old", title: null, message: "定稿", created_at: "2026-10-19T09:00:00.000Z" },
];

const mocks = vi.hoisted(() => ({
  showConfirm: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: versions, error: null }),
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: { status: "ok" }, error: null }),
  }),
}));

vi.mock("@/components/ui/prompt-dialog", () => ({
  showPrompt: vi.fn(),
  showConfirm: (...args: unknown[]) => mocks.showConfirm(...args),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function key(target: Element, keyName: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }));
  });
}

describe("NoteHistoryPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onExitPreview = vi.fn();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    mocks.showConfirm.mockReset();
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    onSelect.mockReset();
    onClose.mockReset();
    onExitPreview.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function render(props: Partial<React.ComponentProps<typeof NoteHistoryPanel>> = {}) {
    await act(async () => {
      root.render(createElement(NoteHistoryPanel, {
        noteId: "note-1",
        open: true,
        activeVersionId: null,
        canEdit: true,
        onClose,
        onExitPreview,
        onSelect,
        ...props,
      }));
    });
    await flush();
  }

  function listbox() {
    const list = container.querySelector('[role="listbox"]');
    if (!list) throw new Error("版本列表未渲染");
    return list;
  }

  it("↑/↓、Home/End、Enter 切换并预览", async () => {
    await render();
    expect(container.textContent).toContain("定稿");
    expect(container.textContent).toContain("最新稿");

    key(listbox(), "ArrowDown");
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "old" }));

    onSelect.mockClear();
    key(listbox(), "Home");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));

    onSelect.mockClear();
    key(listbox(), "End");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "old" }));

    onSelect.mockClear();
    key(listbox(), "Enter");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "old" }));
  });

  it("Esc 先退出预览，再关闭侧栏；对话框打开时不抢 Esc", async () => {
    await render({ activeVersionId: "new" });
    const selected = container.querySelector('[role="option"][aria-selected="true"]');
    expect(selected?.getAttribute("data-version-id")).toBe("new");
    expect(selected?.getAttribute("aria-current")).toBe("true");

    key(document.body, "Escape");
    expect(onExitPreview).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await render({ activeVersionId: null });
    key(document.body, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    key(document.body, "Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("删除当前预览版本要确认，确认后调用 DELETE 并退出预览", async () => {
    mocks.showConfirm.mockResolvedValue(true);
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
    await render({ activeVersionId: "new" });
    const button = container.querySelector('[data-version-id="new"] button[aria-label="删除此版本"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    await act(async () => {
      button.click();
    });
    await flush();
    expect(mocks.showConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "删除这个历史版本？",
      destructive: true,
    }));
    expect(mocks.fetch).toHaveBeenCalledWith("/api/notes/note-1/versions/new", { method: "DELETE" });
    expect(onExitPreview).toHaveBeenCalled();
    expect(container.querySelector('[data-version-id="new"]')).toBeNull();
  });

  it("取消删除不请求接口", async () => {
    mocks.showConfirm.mockResolvedValue(false);
    await render({ activeVersionId: "old" });
    const button = container.querySelector('[data-version-id="old"] button[aria-label="删除此版本"]') as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    await flush();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(container.querySelector('[data-version-id="old"]')).not.toBeNull();
  });

  it("无编辑权限时不显示删除", async () => {
    await render({ canEdit: false });
    expect(container.querySelector('[aria-label="删除此版本"]')).toBeNull();
    expect(container.textContent).toContain("命名版本");
  });
});
