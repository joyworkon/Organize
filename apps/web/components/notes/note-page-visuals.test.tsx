// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotePageVisuals } from "./note-page-visuals";
const backend = vi.hoisted(() => ({ upload: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: backend.getUser }, storage: { from: () => ({ upload: backend.upload, getPublicUrl: () => ({ data: { publicUrl: "https://example.com/new.png" } }) }) } }) }));
let host: HTMLDivElement; let root: Root;
let props: React.ComponentProps<typeof NotePageVisuals>;
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.getAttribute("aria-label") === name || node.textContent === name)!;
const click = (name: string) => act(() => button(name).click());
const key = (node: Element, value: string, extra = {}) => act(() => node.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra })));
const render = () => act(() => root.render(<NotePageVisuals {...props} />));
const input = (node: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true }));
});
const drop = async (file: File) => { await act(async () => {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file], types: ["Files"] } });
  host.querySelector(".note-page-visuals")!.dispatchEvent(event);
}); };
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); vi.clearAllMocks();
  backend.getUser.mockResolvedValue({ data: { user: { id: "user" } } }); backend.upload.mockResolvedValue({ error: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { noteId: "note", contentClassName: "lane", icon: null, coverUrl: "https://example.com/old.png", coverPosition: 50, commentsOpen: false, commentCount: 0,
    onIconChange: vi.fn(), onCoverChange: vi.fn(), onCoverPositionChange: vi.fn(), onToggleComments: vi.fn(), onError: vi.fn() };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("封面重定位", () => {
  const region = () => host.querySelector<HTMLElement>('[aria-label="调整封面位置"][role="group"]')!;
  it("方向键仅预览，Enter 保存一次且还焦点", () => {
    render(); click("调整封面位置"); key(region(), "ArrowDown"); key(region(), "ArrowDown"); key(region(), "ArrowUp");
    expect(region().style.backgroundPosition).toBe("center 51%"); expect(props.onCoverPositionChange).not.toHaveBeenCalled(); key(region(), "Enter");
    expect(props.onCoverPositionChange).toHaveBeenCalledExactlyOnceWith(51); expect(document.activeElement).toBe(button("调整封面位置"));
  });
  it.each(["Escape", "取消"])("%s 丢弃草稿，再次进入恢复原位置", (action) => {
    render(); click("调整封面位置"); key(region(), "ArrowDown");
    if (action === "Escape") key(region(), action); else click(action);
    expect(props.onCoverPositionChange).not.toHaveBeenCalled(); click("调整封面位置");
    expect((host.querySelector('[aria-label="封面垂直位置"]') as HTMLInputElement).value).toBe("50");
  });
  it("range 辅助与保存按钮复用草稿，IME Enter 不保存", () => {
    render(); click("调整封面位置"); const range = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    input(range, "73"); key(range, "Enter", { isComposing: true }); expect(props.onCoverPositionChange).not.toHaveBeenCalled();
    click("保存位置"); expect(props.onCoverPositionChange).toHaveBeenCalledExactlyOnceWith(73);
  });
  it("指针拖动只改预览", () => {
    render(); click("调整封面位置"); const node = region(); node.setPointerCapture = vi.fn(); Object.defineProperty(node, "clientHeight", { value: 200 });
    for (const [type, clientY] of [["pointerdown", 100], ["pointermove", 80], ["pointerup", 80]] as const) act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientY }); Object.defineProperty(event, "pointerId", { value: 1 }); node.dispatchEvent(event);
    });
    expect(node.style.backgroundPosition).toBe("center 60%"); expect(props.onCoverPositionChange).not.toHaveBeenCalled();
    click("取消"); expect(props.onCoverPositionChange).not.toHaveBeenCalled();
  });
});
describe("图标选择器", () => {
  const open = () => { render(); click("添加图标"); };
  const entries = () => document.querySelectorAll<HTMLButtonElement>('[aria-label="图标列表"] button');
  it("中英文搜索、分类、命名与无结果", () => {
    open(); const search = document.querySelector<HTMLInputElement>('[aria-label="搜索图标"]')!;
    input(search, "幼苗"); expect(entries()).toHaveLength(1); expect(entries()[0].textContent).toBe("🌱");
    input(search, "LAPTOP"); expect(entries()[0].textContent).toBe("💻");
    input(search, "no-match"); expect(document.body.textContent).toContain("没有匹配");
    click("自然"); expect(entries()).toHaveLength(6); expect(search.value).toBe(""); expect(Array.from(entries()).every((node) => node.getAttribute("aria-label"))).toBe(true);
  });
  it("方向键移动，选中关闭并还焦点", async () => {
    open(); const grid = entries(); act(() => grid[0].focus()); key(grid[0], "ArrowRight"); expect(document.activeElement).toBe(grid[1]);
    key(grid[1], "ArrowDown"); expect(document.activeElement).toBe(grid[7]); key(grid[7], "ArrowUp"); key(grid[1], "ArrowLeft"); expect(document.activeElement).toBe(grid[0]);
    await act(async () => { grid[0].click();  });
    expect(props.onIconChange).toHaveBeenCalledExactlyOnceWith("💡"); await vi.waitFor(() => expect(document.activeElement).toBe(button("添加图标")));
  });
  it("Escape 关闭并还焦点，不修改", async () => {
    open(); await act(async () => { document.querySelector('[aria-label="搜索图标"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));  });
    expect(props.onIconChange).not.toHaveBeenCalled(); await vi.waitFor(() => expect(document.activeElement).toBe(button("添加图标")));
  });
  it("最近使用限制16并去重，支持随机/移除和存储失败", () => {
    localStorage.setItem("organize:note-recent-icons", JSON.stringify(["😀", "😊", "🥰", "😎", "🤔", "💡", "📘", "📚", "📝", "✍️", "🎯", "🚀", "⭐", "🔥", "✅", "📌"]));
    open(); click("自然"); act(() => entries()[0].click());
    const stored = JSON.parse(localStorage.getItem("organize:note-recent-icons")!); expect(stored).toHaveLength(16); expect(stored[0]).toBe("🌱"); expect(new Set(stored).size).toBe(16);
    click("添加图标"); click("最近使用"); expect(entries()[0].textContent).toBe("🌱"); click("随机图标"); expect(props.onIconChange).toHaveBeenCalledTimes(2);
    props.icon = "🌱"; render(); click("更改页面图标"); click("移除图标"); expect(props.onIconChange).toHaveBeenLastCalledWith(null);
    localStorage.setItem("organize:note-recent-icons", "invalid"); click("更改页面图标"); click("最近使用"); expect(entries()).toHaveLength(0);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); }); click("随机图标"); expect(props.onIconChange).toHaveBeenCalledTimes(4);
  });
});
describe("封面上传", () => {
  it("无封面拖放显示进度态，防重复，成功沿用路径并重置位置", async () => {
    props.coverUrl = null; render(); let complete!: (value: { error: null }) => void;
    backend.upload.mockReturnValue(new Promise((resolve) => { complete = resolve; })); const file = new File(["image"], "cover.png", { type: "image/png" });
    await drop(file); expect(host.querySelector('[role="status"]')?.textContent).toContain("正在上传"); await drop(file); expect(backend.upload).toHaveBeenCalledTimes(1);
    expect(backend.upload.mock.calls[0][0]).toMatch(/^user\/note-covers\/note-\d+\.png$/); await act(async () => complete({ error: null }));
    expect(props.onCoverChange).toHaveBeenCalledExactlyOnceWith("https://example.com/new.png"); expect(props.onCoverPositionChange).toHaveBeenCalledExactlyOnceWith(50);
  });
  it("替换失败保留旧封面，就地重试同一文件", async () => {
    render(); backend.upload.mockResolvedValueOnce({ error: new Error("network") }); const file = new File(["image"], "cover.png", { type: "image/png" }); await drop(file);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("封面上传失败"); expect(host.querySelector<HTMLElement>(".note-page-cover")!.style.backgroundImage).toContain("old.png"); expect(props.onCoverChange).not.toHaveBeenCalled();
    await act(async () => button("重试").click()); expect(backend.upload.mock.calls[1][1]).toBe(file); expect(props.onCoverChange).toHaveBeenCalledTimes(1);
  });
  it.each([new File(["x"], "text.txt", { type: "text/plain" }), new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })])("拒绝无效文件并就地说明", async (file) => {
    render(); await drop(file); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(backend.upload).not.toHaveBeenCalled();
  });
  it("只读没有修改入口，拖放不写入，保留评论", async () => {
    props.readOnly = true; props.icon = "📘"; render(); expect(button("调整封面位置")).toBeUndefined(); expect(button("更改页面图标")).toBeUndefined();
    await drop(new File(["image"], "cover.png", { type: "image/png" })); expect(backend.upload).not.toHaveBeenCalled(); click("添加评论"); expect(props.onToggleComments).toHaveBeenCalledTimes(1);
  });
  it("上传中变为只读，异步结果不提交", async () => {
    let complete!: (value: { error: null }) => void; backend.upload.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(); await drop(new File(["image"], "cover.png", { type: "image/png" })); props.readOnly = true; render(); await act(async () => complete({ error: null })); expect(props.onCoverChange).not.toHaveBeenCalled();
  });
});
