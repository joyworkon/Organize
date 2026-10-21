// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import type { NodeViewProps } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Embed, EmbedView } from "./embed";

const url = "https://example.com/a";
const result = { url, kind: "link-card", title: "文章标题", siteName: "example.com", description: "摘要" };
const response = (body = result, status = 200) => new Response(JSON.stringify(body), { status });

describe("EmbedView automatic resolution", () => {
  let editor: Editor, root: Root, host: HTMLDivElement;
  const fetchMock = vi.fn();
  const getPos = () => {
    let found: number | undefined;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === "embed" && found === undefined) found = pos; });
    return found;
  };
  const updateAttributes = vi.fn((attrs: Record<string, unknown>) => {
    const pos = getPos()!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, ...attrs }));
  });
  function render() {
    const pos = getPos();
    root.render(pos === undefined ? null : <EmbedView {...{ node: editor.state.doc.nodeAt(pos)!, editor, getPos, updateAttributes, selected: false } as unknown as NodeViewProps} />);
  }
  function mount(attrs: Record<string, unknown>, editable = true) {
    editor = new Editor({ extensions: [StarterKit, Embed, UniqueID.configure({ types: ["paragraph", "embed"] })], editable, content: { type: "doc", content: [{ type: "embed", attrs }] } });
    editor.on("transaction", render); act(render);
  }
  async function flush() { await act(async () => {}); }
  function button(name: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === name)!; }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); updateAttributes.mockClear();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => {
    editor.off("transaction", render); act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ""; vi.unstubAllGlobals();
  });
  it("shows loading immediately, resolves once, writes existing attrs and renders the card", async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    mount({ url }); expect(host.textContent).toContain("解析中…"); expect(host.querySelector('.organize-link-card')).toBeNull();
    act(render); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => complete(response()));
    expect(updateAttributes).toHaveBeenCalledTimes(1);
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ url, title: "文章标题", siteName: "example.com" });
    expect(host.querySelector('.organize-link-card')?.textContent).toContain("文章标题");
    expect(host.querySelector('[data-embed-status="ready"]')).not.toBeNull();
  });
  it("keeps the URL on failure without an automatic retry loop; explicit retry succeeds", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "暂时无法解析" }), { status: 502 })).mockResolvedValueOnce(response());
    mount({ url }); await flush();
    expect(host.textContent).toContain("解析失败：暂时无法解析"); expect(editor.state.doc.firstChild?.attrs.url).toBe(url);
    expect(host.querySelector('.organize-link-card')).toBeNull(); act(render); await flush(); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button("重试").click());
    expect(host.querySelector('.organize-link-card')?.textContent).toContain("文章标题");
  });
  it.each([{ title: "已解析" }, { html: '<p>iframe content</p>', sandbox: 'allow-scripts allow-same-origin allow-same-origin allow-popups' }])("never reparses completed blocks and always strips allow-same-origin: %j", async (attrs) => {
    mount({ url, ...attrs }); await flush(); expect(fetchMock).not.toHaveBeenCalled();
    if (attrs.html) expect(host.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts allow-popups");
  });
  it("readonly never fetches or offers writes; external open remains", async () => {
    mount({ url }, false); await flush(); expect(fetchMock).not.toHaveBeenCalled(); expect(button("编辑链接")).toBeUndefined();
    expect(host.querySelector('[aria-label="在新标签打开原链接"]')).not.toBeNull();
  });
  it.each(["revoke", "delete", "replace", "unmount"])("ignores delayed results after %s", async (action) => {
    let complete!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    mount({ url });
    const oldComplete = complete;
    act(() => {
      if (action === "revoke") editor.setEditable(false);
      if (action === "delete") editor.commands.deleteRange({ from: 0, to: 1 });
      if (action === "replace") editor.commands.updateAttributes("embed", { url: "https://other.example.com" });
      if (action === "unmount") root.render(null);
    });
    await act(async () => oldComplete(response())); expect(updateAttributes).not.toHaveBeenCalled();
  });
  it("follows a moved node and accepts initial ID backfill without losing that ID", async () => {
    let complete!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    mount({ url });
    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.firstChild!.attrs, id: "legacy-backfilled" }));
      editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "前置段落" }] });
    });
    await act(async () => complete(response()));
    expect(updateAttributes).toHaveBeenCalledTimes(1);
    expect(editor.state.doc.lastChild?.attrs).toMatchObject({ id: "legacy-backfilled", title: "文章标题" });
  });
  it("empty slash block stays a placeholder; dialog Escape cancels and confirmation normalizes then resolves", async () => {
    fetchMock.mockResolvedValue(response()); mount({}); await flush(); expect(fetchMock).not.toHaveBeenCalled();
    act(() => button("编辑链接").click()); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
    act(() => button("编辑链接").click());
    const input = document.querySelector("input")!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "example.com/a"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => button("解析并嵌入").click());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url }); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
