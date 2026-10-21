// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusTitleFromBody, isTitleLastLine } from "./note-title-navigation";
let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); document.body.replaceChildren(); });
function setup(content = "<p>first</p><p>second</p>") {
  editor = new Editor({ extensions: [StarterKit], content });
  const title = document.createElement("textarea"); title.value = "标题"; document.body.append(title);
  const event = { key: "ArrowUp", isComposing: false, keyCode: 0, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  return { title, event, editor };
}
describe("标题与首块焦点桥接", () => {
  it.each(["ArrowUp", "Backspace"])("首块行首 %s 返回标题末尾，文档不变", (key) => {
    const { title, editor, event } = setup(); editor.commands.setTextSelection(1); const before = editor.getJSON();
    expect(focusTitleFromBody({ ...event, key }, editor, () => { title.focus(); title.setSelectionRange(title.value.length, title.value.length); })).toBe(true);
    expect(document.activeElement).toBe(title); expect(title.selectionStart).toBe(2); expect(editor.getJSON()).toEqual(before);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
  it("保留非首块、块内、选区、列表及只读行为", () => {
    const { editor, title, event } = setup();
    for (const position of [2, 8]) { editor.commands.setTextSelection(position); expect(focusTitleFromBody(event, editor, () => { title.focus(); title.setSelectionRange(title.value.length, title.value.length); })).toBe(false); }
    editor.commands.setTextSelection({ from: 1, to: 2 }); expect(focusTitleFromBody(event, editor, () => { title.focus(); title.setSelectionRange(title.value.length, title.value.length); })).toBe(false);
    editor.commands.setContent("<ul><li><p>item</p></li></ul>"); editor.commands.setTextSelection(3); expect(focusTitleFromBody(event, editor, () => { title.focus(); title.setSelectionRange(title.value.length, title.value.length); })).toBe(false);
    editor.commands.setContent("<p>first</p>"); editor.commands.setTextSelection(1); editor.setEditable(false); expect(focusTitleFromBody(event, editor, () => { title.focus(); title.setSelectionRange(title.value.length, title.value.length); })).toBe(false);
  });
  it.each([{ domOffset: 0, stateOffset: 3, expected: true }, { domOffset: 2, stateOffset: 1, expected: false }])("实时DOM光标优先于滞后状态：$domOffset / $stateOffset", ({ domOffset, stateOffset, expected }) => {
    const { editor, title, event } = setup();
    document.body.append(editor.view.dom);
    editor.commands.setTextSelection(stateOffset);
    const range = document.createRange();
    range.setStart(editor.view.dom.querySelector("p")!.firstChild!, domOffset);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    expect(editor.state.selection.from).toBe(stateOffset);
    expect(focusTitleFromBody(event, editor, () => title.focus())).toBe(expected);
    expect(event.preventDefault).toHaveBeenCalledTimes(expected ? 1 : 0);
  });
  it("输入法、229、组合键不跳标题", () => {
    const { editor, title, event } = setup(); editor.commands.setTextSelection(1);
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) expect(focusTitleFromBody({ ...event, ...extra }, editor, () => { title.focus(); title.setSelectionRange(title.value.length, title.value.length); })).toBe(false);
  });
  it("标题只在折叠光标最后视觉行向下跳，测量节点清理", () => {
    const { title } = setup(); title.value = "wrapped title"; title.setSelectionRange(1, 1);
    const spy = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{ top: 0 }, { top: 42 }] as unknown as DOMRectList);
    expect(isTitleLastLine(title)).toBe(false); spy.mockReturnValue([{ top: 42 }] as unknown as DOMRectList); expect(isTitleLastLine(title)).toBe(true);
    expect(document.querySelectorAll("span")).toHaveLength(0);
    title.setSelectionRange(0, title.value.length); expect(isTitleLastLine(title)).toBe(false);
    title.setSelectionRange(title.value.length, title.value.length); expect(isTitleLastLine(title)).toBe(true);
  });
});
