// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNoteTree, type NoteTreeItem } from "@/lib/notes/tree";
import { SIDEBAR_TREE_COLLAPSED_KEY } from "@/lib/notes/tree-expansion";
import { NOTE_DRAG_MIME } from "@/components/notes/note-groups-bar";
import { SidebarNoteTree } from "./sidebar-note-tree";

// jsdom 没有 PointerEvent，用 MouseEvent 做最小 polyfill（Radix Dialog 依赖）
if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  supabase: { __fake: true },
  createNewNote: vi.fn(),
  persistNoteMove: vi.fn(),
  persistNoteRename: vi.fn(),
  moveNoteToTrash: vi.fn(),
  scrollIntoView: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.supabase }));
vi.mock("@/lib/notes/create-note", () => ({
  createNewNote: (...args: unknown[]) => mocks.createNewNote(...args),
  describeCreateNoteResult: (result: { status: string }) => `结果:${result.status}`,
}));
vi.mock("@/lib/notes/tree-drop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notes/tree-drop")>();
  return {
    ...actual,
    persistNoteMove: (...args: unknown[]) => mocks.persistNoteMove(...args),
    persistNoteRename: (...args: unknown[]) => mocks.persistNoteRename(...args),
  };
});
vi.mock("@/lib/notes/delete-note", () => ({
  moveNoteToTrash: (...args: unknown[]) => mocks.moveNoteToTrash(...args),
}));

const flatNotes: NoteTreeItem[] = [
  { id: "root", title: "根页面", icon: null, parent_note_id: null, updated_at: "2026-10-04T00:00:00Z" },
  { id: "child", title: "子页面", icon: null, parent_note_id: "root", updated_at: "2026-10-03T00:00:00Z" },
  { id: "leaf", title: "叶子页面", icon: null, parent_note_id: "child", updated_at: "2026-10-02T00:00:00Z" },
  { id: "other", title: "其它页面", icon: null, parent_note_id: null, updated_at: "2026-10-01T00:00:00Z" },
];
const treeNodes = buildNoteTree(flatNotes);

/** jsdom 没有 DragEvent/DataTransfer 实现：普通 Event 挂 dataTransfer 形状 */
function fireDragEvent(
  target: Element | Document,
  type: "dragstart" | "dragover" | "dragleave" | "drop" | "dragend",
  data: Record<string, string> = {}
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: [NOTE_DRAG_MIME],
      getData: (mime: string) => data[mime] ?? "",
      setData: () => {},
      dropEffect: "move",
      effectAllowed: "move",
    },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

function rowOf(container: HTMLElement, id: string): HTMLElement {
  const row = container.querySelector(`[data-sidebar-note-id="${id}"]`);
  if (!row) throw new Error(`找不到行 ${id}`);
  return row as HTMLElement;
}

function openContextMenu(row: HTMLElement) {
  act(() => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 8 })
    );
  });
}

function menuItems(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll('[role="menuitem"]'));
}

describe("SidebarNoteTree", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    vi.clearAllMocks();
    mocks.createNewNote.mockResolvedValue({ status: "created", noteId: "new-note-id" });
    mocks.persistNoteMove.mockResolvedValue(undefined);
    mocks.persistNoteRename.mockResolvedValue(undefined);
    mocks.moveNoteToTrash.mockResolvedValue("deleted");
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = mocks.scrollIntoView;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  const render = async (
    props: Partial<Parameters<typeof SidebarNoteTree>[0]> = {}
  ) => {
    await act(async () => {
      root.render(
        createElement(SidebarNoteTree, {
          nodes: treeNodes,
          pathname: "/notes",
          onNavigate: () => {},
          allNotes: flatNotes,
          ...props,
        })
      );
    });
    // 让「读 localStorage → 自动展开祖先 → scrollIntoView」这类链式 effect 全部落地
    await act(async () => {});
    await act(async () => {});
  };

  it("行内操作：每行都有「新建子页面」「更多操作」按钮（aria-label），链接带 focus-visible 焦点环", async () => {
    await render();
    expect(container.querySelectorAll('button[aria-label="新建子页面"]').length).toBe(4);
    expect(container.querySelectorAll('button[aria-label="更多操作"]').length).toBe(4);
    const link = container.querySelector('a[href="/notes/root"]')!;
    expect(link.className).toContain("focus-visible:ring-2");
    expect(link.className).toContain("focus-visible:ring-ring");
  });

  it("「+」新建子页面：调 createNewNote 带 parent_note_id，成功后跳转新页面", async () => {
    await render();
    const plus = rowOf(container, "root").querySelector('button[aria-label="新建子页面"]') as HTMLButtonElement;
    await act(async () => {
      plus.click();
    });
    expect(mocks.createNewNote).toHaveBeenCalledTimes(1);
    expect(mocks.createNewNote).toHaveBeenCalledWith(mocks.supabase, { parent_note_id: "root" });
    expect(mocks.router.push).toHaveBeenCalledWith("/notes/new-note-id");
  });

  it("创建进行中的行「+」按钮禁用，防止连点", async () => {
    let release: (() => void) | null = null;
    mocks.createNewNote.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ status: "created", noteId: "n" }); })
    );
    await render();
    const plus = rowOf(container, "root").querySelector('button[aria-label="新建子页面"]') as HTMLButtonElement;
    await act(async () => {
      plus.click();
    });
    expect(plus.disabled).toBe(true);
    await act(async () => {
      release?.();
    });
    expect(plus.disabled).toBe(false);
  });

  it("右键菜单：按顺序渲染 打开/新建子页面/重命名/移动到/复制链接/删除，删除为危险样式", async () => {
    await render();
    openContextMenu(rowOf(container, "root"));
    const items = menuItems();
    expect(items.map((el) => el.textContent)).toEqual([
      "打开",
      "新建子页面",
      "重命名",
      "移动到",
      "复制链接",
      "删除",
    ]);
    expect(items[5].className).toContain("text-destructive");
  });

  it("「⋯」按钮打开与右键相同的菜单", async () => {
    await render();
    const more = rowOf(container, "other").querySelector('button[aria-label="更多操作"]') as HTMLButtonElement;
    await act(async () => {
      more.click();
    });
    expect(menuItems().map((el) => el.textContent)).toContain("重命名");
  });

  it("只读行（isNoteWritable=false）：菜单只给 打开 / 复制链接", async () => {
    await render({ isNoteWritable: () => false });
    openContextMenu(rowOf(container, "root"));
    expect(menuItems().map((el) => el.textContent)).toEqual(["打开", "复制链接"]);
  });

  it("重命名：菜单进入行内输入框，回车保存调 persistNoteRename，Esc 取消不写库", async () => {
    await render();
    openContextMenu(rowOf(container, "root"));
    const renameItem = menuItems().find((el) => el.textContent === "重命名")!;
    await act(async () => {
      renameItem.click();
    });
    const input = rowOf(container, "root").querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("根页面");

    input.value = "新名字";
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(mocks.persistNoteRename).toHaveBeenCalledTimes(1);
    expect(mocks.persistNoteRename.mock.calls[0][1]).toBe("root");
    expect(mocks.persistNoteRename.mock.calls[0][2]).toBe("新名字");
    expect(rowOf(container, "root").querySelector("input")).toBeNull();

    // Esc 取消：不写库
    openContextMenu(rowOf(container, "root"));
    await act(async () => {
      menuItems().find((el) => el.textContent === "重命名")!.click();
    });
    const input2 = rowOf(container, "root").querySelector("input") as HTMLInputElement;
    input2.value = "不会保存";
    await act(async () => {
      input2.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(mocks.persistNoteRename).toHaveBeenCalledTimes(1);
    expect(rowOf(container, "root").querySelector("input")).toBeNull();
  });

  it("「移动到」打开移动对话框", async () => {
    await render();
    openContextMenu(rowOf(container, "root"));
    await act(async () => {
      menuItems().find((el) => el.textContent === "移动到")!.click();
    });
    expect(document.body.textContent).toContain("将「根页面」移动到其他页面下方");
  });

  it("删除：确认后走 moveNoteToTrash、行本地隐藏；删除当前打开的笔记时跳回 /notes", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await render({ pathname: "/notes/other" });
    openContextMenu(rowOf(container, "other"));
    await act(async () => {
      menuItems().find((el) => el.textContent === "删除")!.click();
    });
    expect(mocks.moveNoteToTrash).toHaveBeenCalledWith("other");
    expect(container.querySelector('[data-sidebar-note-id="other"]')).toBeNull();
    expect(mocks.router.push).toHaveBeenCalledWith("/notes");
    confirmSpy.mockRestore();
  });

  it("删除：取消确认不调 moveNoteToTrash", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render();
    openContextMenu(rowOf(container, "other"));
    await act(async () => {
      menuItems().find((el) => el.textContent === "删除")!.click();
    });
    expect(mocks.moveNoteToTrash).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("拖放嵌套：合法目标 dragover 高亮、drop 调 persistNoteMove；自身/后代不高亮", async () => {
    await render();
    // leaf → root：合法
    fireDragEvent(document, "dragstart", { [NOTE_DRAG_MIME]: "leaf" });
    fireDragEvent(rowOf(container, "root"), "dragover");
    expect(rowOf(container, "root").className).toContain("bg-primary/10");
    expect(rowOf(container, "root").className).toContain("ring-1");
    await act(async () => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: {
          types: [NOTE_DRAG_MIME],
          getData: () => "leaf",
          setData: () => {},
          dropEffect: "move",
          effectAllowed: "move",
        },
      });
      rowOf(container, "root").dispatchEvent(event);
    });
    expect(mocks.persistNoteMove).toHaveBeenCalledTimes(1);
    expect(mocks.persistNoteMove.mock.calls[0][1]).toBe("leaf");
    expect(mocks.persistNoteMove.mock.calls[0][2]).toBe("root");
    fireDragEvent(document, "dragend");
    expect(rowOf(container, "root").className).not.toContain("bg-primary/10");

    // root → child（后代）：不高亮
    fireDragEvent(document, "dragstart", { [NOTE_DRAG_MIME]: "root" });
    fireDragEvent(rowOf(container, "child"), "dragover");
    expect(rowOf(container, "child").className).not.toContain("bg-primary/10");
    // root → root（自身）：不高亮
    fireDragEvent(rowOf(container, "root"), "dragover");
    expect(rowOf(container, "root").className).not.toContain("bg-primary/10");
    fireDragEvent(document, "dragend");
  });

  it("折叠状态持久化：收起后写 localStorage，重挂载仍收起", async () => {
    await render();
    expect(container.querySelector('[data-sidebar-note-id="child"]')).not.toBeNull();
    const chevron = rowOf(container, "root").querySelector('button[aria-label="收起子页面"]') as HTMLButtonElement;
    await act(async () => {
      chevron.click();
    });
    expect(container.querySelector('[data-sidebar-note-id="child"]')).toBeNull();
    expect(JSON.parse(localStorage.getItem(SIDEBAR_TREE_COLLAPSED_KEY) || "[]")).toContain("root");

    // 重挂载（模拟刷新）：仍收起
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await render();
    expect(container.querySelector('[data-sidebar-note-id="child"]')).toBeNull();
  });

  it("当前打开的深层笔记：祖先自动展开并 scrollIntoView 一次", async () => {
    localStorage.setItem(SIDEBAR_TREE_COLLAPSED_KEY, JSON.stringify(["root", "child"]));
    await render({ pathname: "/notes/leaf" });
    expect(container.querySelector('[data-sidebar-note-id="leaf"]')).not.toBeNull();
    const stored = JSON.parse(localStorage.getItem(SIDEBAR_TREE_COLLAPSED_KEY) || "[]");
    expect(stored).not.toContain("root");
    expect(stored).not.toContain("child");
    expect(mocks.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(mocks.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
