/**
 * 编辑器根节点（.ProseMirror）的 ARIA 语义。
 *
 * Playwright 的 toBeEditable 与读屏器都按 role=textbox + aria-readonly 判定
 * 可编辑状态；aria-readonly 必须与 editor.isEditable 严格一致，否则锁定态
 * 会被误判为可编辑。tiptap 的 setEditable 内部用旧渲染闭包的 editorProps
 * 调 view.setProps，attributes 里的 aria-readonly 会滞后一拍，因此
 * setEditable 之后还需 syncEditorAriaReadonly 直接落到根 dom 上。
 */
export interface EditorAriaHost {
  isEditable: boolean;
  view: { dom: HTMLElement };
}

/** 根 dom 的 ARIA 属性渲染快照（editorProps.attributes 的 ARIA 部分） */
export function editorTextboxAria(editable: boolean): Record<string, string> {
  return {
    role: "textbox",
    "aria-multiline": "true",
    "aria-readonly": String(!editable),
  };
}

/** setEditable 之后调用：把 aria-readonly 对齐到编辑器当前可编辑状态 */
export function syncEditorAriaReadonly(editor: EditorAriaHost): void {
  editor.view.dom.setAttribute("aria-readonly", String(!editor.isEditable));
}
