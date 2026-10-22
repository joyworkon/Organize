// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import Collaboration from "@tiptap/extension-collaboration";
import { Doc } from "yjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineMath, MathBlock } from "./math";
import { SyncedBlock } from "./synced-block";
import { buildSyncedReference, canPasteSyncedReference, copySyncedReference, parseSyncedReference, pasteSyncedReference, unlinkSyncedBlock } from "./synced-block-actions";
import { replaceSyncedBlockContent } from "./synced-block-sync";
import { duplicateBlockAtPosition } from "../block-shortcuts";
import { toast } from "@/hooks/use-toast";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const editors: Editor[] = [];
function create(content: JSONContent[] = [{ type: "paragraph" }]) {
  const editor = new Editor({
    extensions: [StarterKit, SyncedBlock, InlineMath, MathBlock, UniqueID.configure({ types: ["paragraph", "syncedBlock", "listItem"] })],
    editorProps: { handleScrollToSelection: () => true }, content: { type: "doc", content },
  });
  editors.push(editor); return editor;
}
afterEach(() => { editors.splice(0).forEach((e) => e.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const synced = (content: JSONContent[]): JSONContent => ({ type: "syncedBlock", attrs: { syncedId: id, hydrated: true, id: "container" }, content });

describe("synced block actions", () => {
  it("keeps unlink as a separate undo step in a collaborative editor", () => {
    const doc = new Doc();
    const editor = new Editor({ extensions: [StarterKit.configure({ history: false }), SyncedBlock, Collaboration.configure({ document: doc })], editorProps: { handleScrollToSelection: () => true } });
    editors.push(editor);
    editor.commands.setContent({ type: "doc", content: [synced([{ type: "paragraph", content: [{ type: "text", text: "正文" }] }])] });
    editor.commands.insertContentAt(2, "之前的编辑");
    const before = editor.getJSON();
    expect(unlinkSyncedBlock(editor, 0, id)).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });
  it("unwraps rich nested children exactly, makes no request, and undoes independently of prior edits", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const editor = create([synced([
      { type: "paragraph", attrs: { id: "child" }, content: [{ type: "text", text: "正文", marks: [{ type: "bold" }] }] },
      { type: "bulletList", content: [{ type: "listItem", attrs: { id: "item" }, content: [{ type: "paragraph", attrs: { id: "nested" }, content: [{ type: "text", text: "嵌套" }] }] }] },
    ])]);
    editor.commands.insertContentAt(2, "前次编辑");
    const before = editor.getJSON(), children = editor.state.doc.firstChild!.content.toJSON();
    expect(unlinkSyncedBlock(editor, 0, id)).toBe(true);
    expect(editor.getJSON().content).toEqual(children);
    expect(fetch).not.toHaveBeenCalled();
    expect(replaceSyncedBlockContent(editor, 0, [{ type: "paragraph" }], id)).toBe(false);
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.redo()).toBe(true); expect(editor.getJSON().content).toEqual(children);
  });

  it("validates whole versioned UUID tokens", () => {
    expect(parseSyncedReference(` \n${buildSyncedReference(id)}\n`)).toBe(id);
    for (const bad of ["", "not-uuid", `${id}/extra`, `<script>${id}</script>`]) expect(buildSyncedReference(bad)).toBeNull();
    for (const bad of [id, `organize-synced-block:v2:${id}`, `${buildSyncedReference(id)} text`, "organize-synced-block:v1:"]) expect(parseSyncedReference(bad)).toBeNull();
  });

  it("pastes the same source without POST, and duplicate retains syncedId with new block ids", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const editor = create([{ type: "paragraph", attrs: { id: "empty" } }]); editor.commands.setTextSelection(1);
    const before = editor.getJSON();
    expect(pasteSyncedReference(editor, buildSyncedReference(id)!)).toBe(true);
    expect(editor.state.doc.firstChild!.attrs).toMatchObject({ syncedId: id, hydrated: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.redo()).toBe(true);
    expect(duplicateBlockAtPosition(editor, 0)).toBe(true);
    expect(editor.state.doc.child(1).attrs.syncedId).toBe(id);
    expect(editor.state.doc.child(1).attrs.id).not.toBe(editor.state.doc.child(0).attrs.id);
    expect(replaceSyncedBlockContent(editor, 0, [{ type: "paragraph" }], "other-id")).toBe(false);
  });

  it.each([
    [{ type: "paragraph" }, true],
    [{ type: "paragraph", content: [{ type: "text", text: "  " }] }, true],
    [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }, false],
    [{ type: "heading", attrs: { level: 1 } }, false],
    [{ type: "codeBlock" }, false],
    [{ type: "mathBlock", attrs: { latex: "" } }, false],
    [{ type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "" } }] }, false],
    [{ type: "paragraph", content: [{ type: "text", text: " ", marks: [{ type: "code" }] }] }, false],
  ] as [JSONContent, boolean][])("guards paragraph context %j", (node, expected) => {
    const editor = create([node]); editor.commands.setTextSelection(1);
    expect(canPasteSyncedReference(editor)).toBe(expected);
    editor.setEditable(false); expect(canPasteSyncedReference(editor)).toBe(false);
  });

  it("rejects selections, stored code, required list paragraphs, nested synced blocks and stale unlink targets", () => {
    const editor = create([{ type: "paragraph", content: [{ type: "text", text: "  " }] }]);
    editor.commands.setTextSelection({ from: 1, to: 2 }); expect(canPasteSyncedReference(editor)).toBe(false);
    editor.commands.setTextSelection(1); editor.commands.setMark("code"); expect(canPasteSyncedReference(editor)).toBe(false);
    editor.commands.setNodeSelection(0); expect(canPasteSyncedReference(editor)).toBe(false);
    editor.commands.setContent({ type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] });
    editor.commands.setTextSelection(3); expect(canPasteSyncedReference(editor)).toBe(false);
    editor.commands.setContent({ type: "doc", content: [synced([{ type: "paragraph" }])] });
    editor.commands.setTextSelection(2); expect(canPasteSyncedReference(editor)).toBe(false);
    expect(unlinkSyncedBlock(editor, 0, "stale-id")).toBe(false);
    editor.setEditable(false); expect(unlinkSyncedBlock(editor, 0, id)).toBe(false);
    expect(unlinkSyncedBlock(editor, -1, id)).toBe(false);
  });

  it("copies in readonly mode, reports rejected clipboard access and invalid IDs", async () => {
    const editor = create([synced([{ type: "paragraph" }])]); editor.setEditable(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copySyncedReference(id)).toBe(true);
    expect(writeText).toHaveBeenCalledWith(buildSyncedReference(id));
    expect(toast).toHaveBeenCalledWith({ title: "已复制同步引用，粘贴到笔记可插入同一同步区块" });
    writeText.mockRejectedValue(new Error("denied")); expect(await copySyncedReference(id)).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "复制同步引用失败", variant: "destructive" }));
    writeText.mockClear(); expect(await copySyncedReference("")).toBe(false); expect(writeText).not.toHaveBeenCalled();
  });
});
