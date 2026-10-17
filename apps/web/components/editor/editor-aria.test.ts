// @vitest-environment jsdom
/**
 * 编辑器根 dom（.ProseMirror）的 textbox ARIA 语义：
 * - editorTextboxAria 渲染快照提供 role/aria-multiline/aria-readonly 初值
 * - tiptap 的 setEditable 用旧渲染闭包的 editorProps 调 view.setProps，
 *   attributes 里的 aria-readonly 滞后一拍，必须经 syncEditorAriaReadonly
 *   落回根 dom（否则锁定窗口会被 Playwright toBeEditable / 读屏器判为可编辑）
 * - 下面用真实 @tiptap/core Editor 钉住该机制合同，防止 tiptap 升级悄悄
 *   改变 attributes 覆盖行为（role 被擦 / aria-readonly 不刷新）
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { editorTextboxAria, syncEditorAriaReadonly } from "./editor-aria";

const editors: Editor[] = [];

function createEditor(editable: boolean): Editor {
  const editor = new Editor({
    extensions: [StarterKit],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editable,
    editorProps: {
      // 与 tiptap-editor.tsx 相同的装配方式：class + ARIA 渲染快照
      attributes: {
        class: "organize-editor",
        ...editorTextboxAria(editable),
      },
    },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("editorTextboxAria（渲染快照纯函数）", () => {
  it("可编辑：textbox 多行、非只读", () => {
    expect(editorTextboxAria(true)).toEqual({
      role: "textbox",
      "aria-multiline": "true",
      "aria-readonly": "false",
    });
  });

  it("锁定：aria-readonly=true，其余不变", () => {
    expect(editorTextboxAria(false)).toEqual({
      role: "textbox",
      "aria-multiline": "true",
      "aria-readonly": "true",
    });
  });
});

describe("aria-readonly 与 isEditable 联动（真实 tiptap Editor）", () => {
  it("创建即带 role/aria-multiline/aria-readonly 初值（可编辑）", () => {
    const editor = createEditor(true);
    expect(editor.view.dom.getAttribute("role")).toBe("textbox");
    expect(editor.view.dom.getAttribute("aria-multiline")).toBe("true");
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("false");
  });

  it("锁定创建：初值 aria-readonly=true", () => {
    const editor = createEditor(false);
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("true");
  });

  it("锁定：setEditable(false) 后 sync 出 aria-readonly=true", () => {
    const editor = createEditor(true);
    editor.setEditable(false);
    syncEditorAriaReadonly(editor);
    expect(editor.isEditable).toBe(false);
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("true");
  });

  it("从锁定切回可编辑后变回 false，role/aria-multiline 不被 setEditable 擦除", () => {
    const editor = createEditor(false);
    editor.setEditable(true);
    syncEditorAriaReadonly(editor);
    expect(editor.isEditable).toBe(true);
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("false");
    expect(editor.view.dom.getAttribute("role")).toBe("textbox");
    expect(editor.view.dom.getAttribute("aria-multiline")).toBe("true");
  });

  it("机制合同：setEditable 自身不刷新 aria-readonly（滞后一拍），sync 是唯一落点", () => {
    // 若 tiptap 未来升级为 setEditable 自动带出正确的 aria-readonly，
    // 本断言会失败——届时 sync 已幂等、可直接删掉本用例
    const editor = createEditor(true);
    editor.setEditable(false);
    expect(editor.view.dom.getAttribute("aria-readonly")).toBe("false");
  });
});
