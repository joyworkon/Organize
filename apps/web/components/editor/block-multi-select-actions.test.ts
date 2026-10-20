// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Details from "@tiptap/extension-details";
import DetailsSummary from "@tiptap/extension-details-summary";
import DetailsContent from "@tiptap/extension-details-content";
import Image from "@tiptap/extension-image";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Callout } from "./extensions/callout";
import { BlockStyle } from "./extensions/block-style";
import { BLOCK_ID_TYPES } from "./block-utils";
import { BlockMultiSelect, getMultiSelectedBlocks, setMultiSelectedBlocks } from "./extensions/block-multi-select";
import { colorSelectedBlocks, contiguousBlockGroup, deleteSelectedBlocksWithConfirmation, moveSelectedBlocks, selectedBlocks, selectionNeedsDeleteConfirmation, transformSelectedBlocks, wrapSelectedBlocks } from "./block-multi-select-actions";
import { showConfirm } from "@/components/ui/prompt-dialog";
vi.mock("@/components/ui/prompt-dialog", () => ({ showConfirm: vi.fn() }));
const editors: Editor[] = [];
const p = (text: string, id = text): JSONContent => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
function create(content: JSONContent[] = [p("甲"), p("乙"), p("丙"), p("丁")]) {
  const editor = new Editor({ extensions: [StarterKit, UniqueID.configure({ types: BLOCK_ID_TYPES }), TextStyle, Color, Details, DetailsSummary, DetailsContent, Image, Callout, BlockStyle, BlockMultiSelect], content: { type: "doc", content }, editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor);
  setMultiSelectedBlocks(editor, [0, editor.state.doc.firstChild!.nodeSize]);
  return editor;
}
function topPositions(editor: Editor) { const result: number[] = []; editor.state.doc.forEach((_, pos) => result.push(pos)); return result; }
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); vi.resetAllMocks(); });

describe("multi-block actions with UniqueID and real undo history", () => {
  it("transforms headings bottom-up, preserves IDs/highlights and undoes once", () => {
    const editor = create(); const before = editor.getJSON();
    expect(transformSelectedBlocks(editor, "heading-2")).toEqual({ applied: true, skipped: 0 });
    expect(editor.state.doc.child(0).type.name).toBe("heading");
    expect(editor.state.doc.child(1).attrs).toMatchObject({ id: "乙", level: 2 });
    expect(getMultiSelectedBlocks(editor)).toEqual([0, 3]);
    expect(editor.view.dom.querySelectorAll(".organize-block-selected")).toHaveLength(2);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  });
  it("joins converted lists, preserves item IDs and selects their new container", () => {
    const editor = create(); const before = editor.getJSON();
    transformSelectedBlocks(editor, "bullet-list");
    const list = editor.state.doc.firstChild!;
    expect(list.type.name).toBe("bulletList"); expect(list.childCount).toBe(2);
    expect(list.child(0).attrs.id).toBe("甲"); expect(list.child(1).attrs.id).toBe("乙");
    expect(getMultiSelectedBlocks(editor)).toEqual([0]);
    expect(editor.view.dom.querySelectorAll(".organize-block-selected")).toHaveLength(1);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  });
  it("skips images without discarding the other selected blocks", () => {
    const editor = create([p("甲"), { type: "image", attrs: { id: "image", src: "https://example.com/a.png" } }, p("乙")]);
    expect(transformSelectedBlocks(editor, "heading-1")).toEqual({ applied: true, skipped: 1 });
    expect(editor.state.doc.child(1).attrs.id).toBe("image");
    expect(editor.state.doc.child(1).type.name).toBe("image");
    expect(getMultiSelectedBlocks(editor)).toEqual([0, 3]);
    expect(transformSelectedBlocks(editor, "page").applied).toBe(false);
  });
  it("applies backgrounds and text colors as separate single undo actions", () => {
    const editor = create(); const before = editor.getJSON();
    colorSelectedBlocks(editor, "background", "rgba(51,126,169,.14)");
    const colored = editor.getJSON();
    expect(editor.state.doc.child(0).attrs.backgroundColor).toBe("rgba(51,126,169,.14)");
    expect(editor.state.doc.child(1).attrs.backgroundColor).toBe("rgba(51,126,169,.14)");
    expect(editor.state.doc.child(2).attrs.backgroundColor).toBeNull();
    colorSelectedBlocks(editor, "text", "#337ea9");
    expect(editor.state.doc.child(1).firstChild!.marks[0].attrs.color).toBe("#337ea9");
    expect(getMultiSelectedBlocks(editor)).toEqual([0, 3]);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(colored);
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  });
  it("unsets text color and colors nested list items without adding unsupported attrs", () => {
    const editor = create(); transformSelectedBlocks(editor, "bullet-list");
    colorSelectedBlocks(editor, "background", "red");
    expect(editor.state.doc.firstChild!.attrs.backgroundColor).toBeUndefined();
    expect(editor.state.doc.firstChild!.child(1).attrs.backgroundColor).toBe("red");
    colorSelectedBlocks(editor, "text", "#337ea9"); colorSelectedBlocks(editor, "text", null);
    expect(editor.state.doc.firstChild!.child(0).firstChild!.firstChild!.marks).toEqual([]);
  });
  it.each([-1, 1] as const)("moves a continuous group %s without changing IDs, with undo", (direction) => {
    const editor = create(); const before = editor.getJSON(); setMultiSelectedBlocks(editor, [3, 6]);
    expect(moveSelectedBlocks(editor, direction)).toBe(true);
    expect(editor.state.doc.textContent).toBe(direction < 0 ? "乙丙甲丁" : "甲丁乙丙");
    expect(getMultiSelectedBlocks(editor)).toEqual(direction < 0 ? [0, 3] : [6, 9]);
    expect(editor.state.doc.child(direction < 0 ? 0 : 2).attrs.id).toBe("乙");
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  });
  it("rejects non-contiguous blocks, different parents and movement at boundaries", () => {
    const editor = create(); setMultiSelectedBlocks(editor, [0, 6]); const before = editor.getJSON();
    expect(contiguousBlockGroup(editor.state.doc, [0, 6])).toBeNull();
    expect(moveSelectedBlocks(editor, -1)).toBe(false); expect(wrapSelectedBlocks(editor, "callout")).toBe(false);
    setMultiSelectedBlocks(editor, [0, 3]); expect(moveSelectedBlocks(editor, -1)).toBe(false);
    setMultiSelectedBlocks(editor, [6, 9]); expect(moveSelectedBlocks(editor, 1)).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    const nested = create([{ type: "callout", content: [p("甲"), p("乙")] }, p("丙")]);
    expect(contiguousBlockGroup(nested.state.doc, [1, topPositions(nested)[1]])).toBeNull();
    expect(selectedBlocks(editor.state.doc, [-1, 1, 100, 0, 0]).map(({ pos }) => pos)).toEqual([0]);
  });
  it.each(["callout", "details"] as const)("wraps in %s retaining every original block ID and supports undo", (kind) => {
    const editor = create(); const before = editor.getJSON();
    expect(wrapSelectedBlocks(editor, kind)).toBe(true);
    const wrapper = editor.state.doc.firstChild!; expect(wrapper.type.name).toBe(kind);
    const content = kind === "callout" ? wrapper : wrapper.child(1);
    expect(content.child(0).attrs.id).toBe("甲"); expect(content.child(1).attrs.id).toBe("乙");
    expect(content.textContent).toBe("甲乙");
    if (kind === "details") expect(wrapper.firstChild!.textContent).toBe("甲");
    else expect(wrapper.attrs.emoji).toBe("💡");
    expect(getMultiSelectedBlocks(editor)).toEqual([0]);
    editor.state.doc.check(); editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  });
  it("single-block details uses empty summary and retains the entire original block", () => {
    const editor = create(); setMultiSelectedBlocks(editor, [0]); wrapSelectedBlocks(editor, "details");
    expect(editor.state.doc.firstChild!.firstChild!.textContent).toBe("");
    expect(editor.state.doc.firstChild!.child(1).firstChild!.attrs.id).toBe("甲");
  });
  it("moves siblings inside a container but only wraps top-level selections", () => {
    const editor = create([{ type: "callout", content: [p("甲"), p("乙"), p("丙")] }]);
    setMultiSelectedBlocks(editor, [4, 7]);
    expect(wrapSelectedBlocks(editor, "callout")).toBe(false);
    expect(moveSelectedBlocks(editor, -1)).toBe(true);
    expect(editor.state.doc.textContent).toBe("乙丙甲");
    expect(getMultiSelectedBlocks(editor)).toEqual([1, 4]);
  });
  it("guards every action when readonly", async () => {
    const editor = create(); const before = editor.getJSON(); editor.setEditable(false);
    expect(transformSelectedBlocks(editor, "heading-1").applied).toBe(false);
    expect(colorSelectedBlocks(editor, "text", "red")).toBe(false);
    expect(moveSelectedBlocks(editor, 1)).toBe(false); expect(wrapSelectedBlocks(editor, "details")).toBe(false);
    expect(await deleteSelectedBlocksWithConfirmation(editor)).toBe(false); expect(editor.getJSON()).toEqual(before);
  });
  it("confirms complex deletion, supports cancellation, restores reviewed selection and undoes", async () => {
    const editor = create([p("甲"), { type: "image", attrs: { id: "image", src: "https://example.com/a.png" } }, p("丙")]);
    const before = editor.getJSON(); expect(selectionNeedsDeleteConfirmation(editor.state.doc, [0, 3])).toBe(true);
    vi.mocked(showConfirm).mockResolvedValueOnce(false);
    expect(await deleteSelectedBlocksWithConfirmation(editor)).toBe(false); expect(editor.getJSON()).toEqual(before);
    let resolve!: (value: boolean) => void;
    vi.mocked(showConfirm).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = deleteSelectedBlocksWithConfirmation(editor); setMultiSelectedBlocks(editor, []); resolve(true);
    expect(await pending).toBe(true); expect(editor.state.doc.textContent).toBe("丙");
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  });
  it("does not delete a changed document after confirmation", async () => {
    const editor = create([p("甲".repeat(501)), p("乙")]);
    let resolve!: (value: boolean) => void;
    vi.mocked(showConfirm).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = deleteSelectedBlocksWithConfirmation(editor); editor.commands.insertContent("新"); resolve(true);
    const changed = editor.getJSON(); expect(await pending).toBe(false); expect(editor.getJSON()).toEqual(changed);
  });
  it.each(["Delete", "Backspace"])("%s confirms complex multi-selection before removing any content", async (key) => {
    const editor = create([p("甲"), { type: "image", attrs: { id: "image", src: "https://example.com/a.png" } }, p("丙")]);
    const before = editor.getJSON();
    vi.mocked(showConfirm).mockResolvedValueOnce(false);
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    expect(editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event))).toBe(true);
    expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await Promise.resolve(); expect(editor.getJSON()).toEqual(before);
  });

});
