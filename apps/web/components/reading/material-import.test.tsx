// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialProcessorExtension, MaterialResult, OrganizePlugin, PluginContext } from "@organize/plugin-sdk";
import { usePluginStore } from "@/lib/plugin/store";
import { collectReadingItem } from "@/lib/reading/collect";
import { MaterialImport } from "./material-import";

vi.mock("@/lib/reading/collect", () => ({ collectReadingItem: vi.fn() }));
vi.mock("@/lib/materials/article", () => ({ materialFingerprint: async () => "a".repeat(64) }));
const result: MaterialResult = { title: "整理结果", category: "资料", tags: ["学习"], blocks: [{ type: "paragraph", text: "识别出的内容" }] };

describe("稍后读物料入口", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let handler: ReturnType<typeof vi.fn<MaterialProcessorExtension["handler"]>>;
  let onAdded: ReturnType<typeof vi.fn<() => void>>;
  let unmounted = false;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(collectReadingItem).mockResolvedValue({ status: "saved", itemId: "reading-1", title: "整理结果", url: "urn:organize:material:a" });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    handler = vi.fn<MaterialProcessorExtension["handler"]>().mockResolvedValue(result); onAdded = vi.fn();
    const plugin: OrganizePlugin = { id: "test", name: "测试整理", version: "1", description: "", extensions: [{ type: "material-processor", id: "organize", label: "整理", handler }] };
    usePluginStore.setState({ activePlugins: new Map([["test", plugin]]), contexts: new Map([["test", { userId: "user-1" } as PluginContext]]) });
    unmounted = false; act(() => root.render(createElement(MaterialImport, { onAdded })));
  });
  afterEach(() => {
    if (!unmounted) act(() => root.unmount()); container.remove();
    usePluginStore.setState({ activePlugins: new Map(), contexts: new Map() });
  });
  const drop = async () => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["原文"], "notes.txt")] } });
    await act(async () => { container.querySelector("section")!.dispatchEvent(event); });
  };
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(label)); expect(button).toBeDefined();
    await act(async () => { button!.click(); });
  };
  it("识别后自动通过统一收集入口保存到稍后读并刷新列表", async () => {
    await drop();
    expect(collectReadingItem).toHaveBeenCalledWith({ kind: "material", key: "a".repeat(64), result, sources: ["notes.txt"] }, { expectedUserId: "user-1" });
    expect(onAdded).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("保存为未读条目");
    expect(container.querySelector('a[href="/library/reading-1"]')).not.toBeNull();
  });
  it("保存失败保留识别结果，重试保存不会重复调用模型", async () => {
    vi.mocked(collectReadingItem).mockResolvedValueOnce({ status: "error", itemId: null, title: null, url: null, message: "网络失败" });
    await drop(); expect(container.textContent).toContain("网络失败");
    await click("重试保存");
    expect(handler).toHaveBeenCalledOnce(); expect(collectReadingItem).toHaveBeenCalledTimes(2);
    expect(onAdded).toHaveBeenCalledOnce();
  });
  it("阻止并发投放，取消后迟到结果不会保存", async () => {
    let resolve!: (value: MaterialResult) => void;
    handler.mockReturnValue(new Promise<MaterialResult>((done) => { resolve = done; }));
    await drop(); await drop(); expect(handler).toHaveBeenCalledOnce(); await click("取消");
    await act(async () => resolve(result)); expect(collectReadingItem).not.toHaveBeenCalled();
  });
  it("离开页面后迟到结果不会保存", async () => {
    let resolve!: (value: MaterialResult) => void;
    handler.mockReturnValue(new Promise<MaterialResult>((done) => { resolve = done; }));
    await drop(); act(() => root.unmount()); unmounted = true;
    await act(async () => resolve(result)); expect(collectReadingItem).not.toHaveBeenCalled();
  });
  it("标签部分失败提示补齐，停用插件不再调用模型", async () => {
    vi.mocked(collectReadingItem).mockResolvedValueOnce({ status: "saved", itemId: "reading-1", title: "结果", url: "urn:x", warning: "部分标签失败" });
    await drop(); expect(container.textContent).toContain("部分标签失败");
    await click("重试保存"); expect(handler).toHaveBeenCalledOnce();
    act(() => usePluginStore.setState({ activePlugins: new Map() })); await drop();
    expect(handler).toHaveBeenCalledOnce(); expect(container.textContent).toContain("插件管理");
  });
});
