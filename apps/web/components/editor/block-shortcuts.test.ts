// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { copyBlockDeepLink, duplicateBlockAtPosition, duplicateBlocksAtPositions, matchNoteEditorShortcut } from "./block-shortcuts";
import { createBlockKeydownHandlers } from "./block-interaction";
import { BlockMultiSelect, getMultiSelectedBlocks, setMultiSelectedBlocks } from "./extensions/block-multi-select";

vi.mock("@/components/ui/prompt-dialog", () => ({ showPrompt: vi.fn() }));
const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => { editor.destroy(); editor.options.element.remove(); });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createEditor() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editorProps: { handleScrollToSelection: () => true },
    extensions: [StarterKit, UniqueID.configure({ types: ["paragraph", "listItem"] }), BlockMultiSelect],
    content: { type: "doc", content: [
      { type: "paragraph", attrs: { id: "first" }, content: [{ type: "text", text: "甲" }] },
      { type: "bulletList", content: [{ type: "listItem", attrs: { id: "item" }, content: [{ type: "paragraph", attrs: { id: "nested" }, content: [{ type: "text", text: "乙" }] }] }] },
      { type: "paragraph", attrs: { id: "last" }, content: [{ type: "text", text: "丙" }] },
    ] },
  });
  editors.push(editor);
  return editor;
}
function event(init: KeyboardEventInit) { return new KeyboardEvent("keydown", { cancelable: true, ...init }); }
function handlers(editor: Editor, isMenuOpen = () => false, noteId: string | undefined = "note-1") {
  return createBlockKeydownHandlers({ getEditor: () => editor, noteId, isMenuOpen, onOpenCommandMenu: vi.fn(), onOpenSearchDialog: vi.fn() });
}
function texts(editor: Editor) { return Array.from({ length: editor.state.doc.childCount }, (_, i) => editor.state.doc.child(i).textContent); }

describe("note block shortcuts", () => {
  it("matches meta/ctrl and physical Option+L, ignores IME, extra modifiers, prevented keys and Cmd+A", () => {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(matchNoteEditorShortcut(event({ key: "d", ...modifier }))).toBe("duplicate");
      expect(matchNoteEditorShortcut(event({ key: "L", altKey: true, ...modifier }))).toBe("copy-link");
    }
    expect(matchNoteEditorShortcut(event({ key: "¬", code: "KeyL", altKey: true, metaKey: true }))).toBe("copy-link");
    for (const init of [{ key: "d" }, { key: "a", metaKey: true }, { key: "l", metaKey: true }, { key: "d", metaKey: true, altKey: true }, { key: "d", metaKey: true, shiftKey: true }, { key: "d", metaKey: true, isComposing: true }, { key: "d", metaKey: true, keyCode: 229 }]) {
      expect(matchNoteEditorShortcut(event(init))).toBeNull();
    }
    const prevented = event({ key: "d", metaKey: true }); prevented.preventDefault();
    expect(matchNoteEditorShortcut(prevented)).toBeNull();
  });

  it("duplicates the current paragraph with a new id and undoes in one step", () => {
    const editor = createEditor();
    const before = editor.getJSON();
    const key = event({ key: "d", metaKey: true });
    expect(handlers(editor)(editor.view, key)).toBe(true);
    expect(key.defaultPrevented).toBe(true);
    expect(texts(editor)).toEqual(["甲", "甲", "乙", "丙"]);
    expect(editor.state.doc.child(1).attrs.id).toBeTruthy();
    expect(editor.state.doc.child(1).attrs.id).not.toBe("first");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("duplicates unordered, adjacent and nonadjacent selected blocks in one undo step and selects copies", () => {
    const editor = createEditor();
    const before = editor.getJSON();
    const positions: number[] = [];
    editor.state.doc.forEach((_, pos) => positions.push(pos));
    editor.commands.setTextSelection(6);
    setMultiSelectedBlocks(editor, [positions[2], positions[0], positions[1], positions[0]]);
    expect(handlers(editor)(editor.view, event({ key: "d", ctrlKey: true }))).toBe(true);
    expect(texts(editor)).toEqual(["甲", "甲", "乙", "乙", "丙", "丙"]);
    const copies = getMultiSelectedBlocks(editor);
    expect(copies).toHaveLength(3);
    expect(copies.map((pos) => editor.state.doc.nodeAt(pos)?.textContent)).toEqual(["甲", "乙", "丙"]);
    const ids: string[] = [];
    editor.state.doc.descendants((node) => { if (node.attrs.id) ids.push(node.attrs.id); });
    expect(ids.length).toBe(8);
    expect(new Set(ids).size).toBe(ids.length);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    // Nonadjacent selection preserves the untouched middle block.
    expect(duplicateBlocksAtPositions(editor, [positions[2], positions[0]])).toBe(true);
    expect(texts(editor)).toEqual(["甲", "甲", "乙", "丙", "丙"]);
  });

  it("ignores a nested cursor for Cmd+D, but keeps nested menu duplication available", () => {
    const editor = createEditor();
    editor.commands.setTextSelection(6);
    expect(editor.state.selection.$from.depth).toBe(3);
    const key = event({ key: "d", metaKey: true });
    expect(handlers(editor)(editor.view, key)).toBe(false);
    expect(key.defaultPrevented).toBe(false);
    expect(duplicateBlockAtPosition(editor, 5)).toBe(true);
    expect(editor.state.doc.child(1).child(0).childCount).toBe(2);
  });

  it("yields to IME, editor menus, dialogs and readonly state without changing content", () => {
    const editor = createEditor();
    const before = editor.getJSON();
    for (const init of [{ key: "d", metaKey: true, isComposing: true }, { key: "d", ctrlKey: true, keyCode: 229 }]) expect(handlers(editor)(editor.view, event(init))).toBe(false);
    expect(handlers(editor, () => true)(editor.view, event({ key: "d", metaKey: true }))).toBe(false);
    const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); document.body.appendChild(dialog);
    expect(handlers(editor)(editor.view, event({ key: "d", metaKey: true }))).toBe(false);
    dialog.remove();
    setMultiSelectedBlocks(editor, [0]);
    editor.setEditable(false);
    expect(handlers(editor)(editor.view, event({ key: "d", metaKey: true }))).toBe(false);
    expect(duplicateBlocksAtPositions(editor, [0])).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it("copies links while readonly, with manual-copy fallback and no-op for missing identifiers", async () => {
    const editor = createEditor();
    editor.setEditable(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(handlers(editor)(editor.view, event({ key: "¬", code: "KeyL", metaKey: true, altKey: true }))).toBe(true);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/notes/note-1#block-first`);
    writeText.mockRejectedValueOnce(new Error("denied"));
    await copyBlockDeepLink("note-1", "first");
    expect(showPrompt).toHaveBeenCalledWith({ title: "复制链接", defaultValue: `${window.location.origin}/notes/note-1#block-first` });
    vi.stubGlobal("navigator", {});
    await copyBlockDeepLink("note-1", "first");
    expect(await copyBlockDeepLink(undefined, "first")).toBe(false);
    expect(await copyBlockDeepLink("note-1", undefined)).toBe(false);
    expect(createBlockKeydownHandlers({ onOpenCommandMenu: vi.fn(), onOpenSearchDialog: vi.fn() })(editor.view, event({ key: "l", ctrlKey: true, altKey: true }))).toBe(false);
  });
  it("leaves missing block ids and nested copy-link targets untouched", () => {
    const editor = createEditor();
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    editor.commands.setTextSelection(6);
    const nested = event({ key: "l", altKey: true, ctrlKey: true });
    expect(handlers(editor)(editor.view, nested)).toBe(false);
    expect(nested.defaultPrevented).toBe(false);
    editor.commands.setContent("<h1>no block id</h1>");
    const missing = event({ key: "l", altKey: true, metaKey: true });
    expect(handlers(editor)(editor.view, missing)).toBe(false);
    expect(missing.defaultPrevented).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

});
