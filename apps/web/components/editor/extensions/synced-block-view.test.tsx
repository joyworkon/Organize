// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SyncedBlock, SyncedBlockView } from "./synced-block";
import { toast } from "@/hooks/use-toast";
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("./synced-block-sync", async (original) => ({ ...await original<object>(), getSyncedUserId: async () => null }));
let editor: Editor, root: Root, host: HTMLDivElement;
const id = "11111111-1111-4111-8111-111111111111";
const buttons = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent === name);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id, content: [{ type: "paragraph" }], revision: 1, updated_at: "now" }]))));
  vi.stubGlobal("BroadcastChannel", class { addEventListener() {} close() {} postMessage() {} });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  editor = new Editor({ extensions: [StarterKit, SyncedBlock], editorProps: { handleScrollToSelection: () => true }, content: { type: "doc", content: [{ type: "syncedBlock", attrs: { syncedId: id }, content: [{ type: "paragraph" }] }] } });
});
afterEach(() => { act(() => root.unmount()); editor.destroy(); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("shows copy in readonly, tracks permission changes, and unwraps from toolbar", async () => {
  act(() => editor.setEditable(false));
  await act(async () => root.render(<SyncedBlockView {...{ editor, node: editor.state.doc.firstChild!, getPos: () => 0 } as unknown as NodeViewProps} />));
  expect(buttons("解除同步")).toHaveLength(0); expect(buttons("复制引用")).toHaveLength(1);
  await act(async () => buttons("复制引用")[0].click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`organize-synced-block:v1:${id}`);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "已复制同步引用，粘贴到笔记可插入同一同步区块" }));
  act(() => editor.setEditable(true)); expect(buttons("解除同步")).toHaveLength(1);
  act(() => editor.setEditable(false)); expect(buttons("解除同步")).toHaveLength(0);
  act(() => editor.setEditable(true)); act(() => buttons("解除同步")[0].click());
  expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
  expect(editor.commands.undo()).toBe(true); expect(editor.state.doc.firstChild!.type.name).toBe("syncedBlock");
});
