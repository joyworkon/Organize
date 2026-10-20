// @vitest-environment jsdom
/**
 * 代码块工具栏纯函数：语言归一化 / 预设菜单、选区归类、显隐规则、可复制文本、style 转对象。
 */
import { Editor } from "@tiptap/core";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODE_BLOCK_LANGUAGES,
  PLAIN_LANGUAGE_LABEL,
  codeBlockCopyText,
  codeBlockLanguageLabel,
  codeBlockLanguageOptions,
  codeBlockSelectionState,
  inlineStyleToObject,
  normalizeCodeBlockLanguage,
  normalizeCodeBlockWrap,
  shouldShowCodeBlockToolbar,
  storedCodeBlockLanguage,
} from "./code-block-language";

describe("code block language normalization", () => {
  it("lowercases ids and maps empty or invalid values to null", () => {
    expect(normalizeCodeBlockLanguage(" TypeScript ")).toBe("typescript");
    expect(normalizeCodeBlockLanguage("c++")).toBe("c++");
    expect(normalizeCodeBlockLanguage("objective-c")).toBe("objective-c");
    expect(normalizeCodeBlockLanguage("")).toBeNull();
    expect(normalizeCodeBlockLanguage("   ")).toBeNull();
    expect(normalizeCodeBlockLanguage(null)).toBeNull();
    expect(normalizeCodeBlockLanguage(undefined)).toBeNull();
    expect(normalizeCodeBlockLanguage(42)).toBeNull();
    expect(normalizeCodeBlockLanguage("<script>")).toBeNull();
    expect(normalizeCodeBlockLanguage("-leading")).toBeNull();
  });

  it("keeps the stored string for data-language and labels presets or raw ids", () => {
    expect(storedCodeBlockLanguage("JS")).toBe("JS");
    expect(storedCodeBlockLanguage("")).toBeNull();
    expect(storedCodeBlockLanguage(null)).toBeNull();
    expect(codeBlockLanguageLabel(null)).toBe(PLAIN_LANGUAGE_LABEL);
    expect(codeBlockLanguageLabel("")).toBe(PLAIN_LANGUAGE_LABEL);
    expect(codeBlockLanguageLabel("python")).toBe("Python");
    expect(codeBlockLanguageLabel("CPP")).toBe("C++");
    expect(codeBlockLanguageLabel("kotlin")).toBe("kotlin");
  });

  it("lists every required preset exactly once with lowercase ids", () => {
    const ids = CODE_BLOCK_LANGUAGES.map((item) => item.id);
    for (const required of ["javascript", "typescript", "tsx", "python", "bash", "json", "css", "html", "markdown", "sql", "go", "rust", "java", "c", "cpp", "yaml", "toml", "plaintext"]) {
      expect(ids).toContain(required);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id === id.toLowerCase())).toBe(true);
  });

  it("prepends an unknown current language so it stays selectable", () => {
    expect(codeBlockLanguageOptions(null)).toEqual(CODE_BLOCK_LANGUAGES);
    expect(codeBlockLanguageOptions("python")).toEqual(CODE_BLOCK_LANGUAGES);
    const options = codeBlockLanguageOptions("kotlin");
    expect(options[0]).toEqual({ id: "kotlin", label: "kotlin" });
    expect(options.slice(1)).toEqual(CODE_BLOCK_LANGUAGES);
  });

  it("wrap defaults to false and only true or data-wrap=\"true\" enable it", () => {
    expect(normalizeCodeBlockWrap(undefined)).toBe(false);
    expect(normalizeCodeBlockWrap(null)).toBe(false);
    expect(normalizeCodeBlockWrap(false)).toBe(false);
    expect(normalizeCodeBlockWrap("false")).toBe(false);
    expect(normalizeCodeBlockWrap("")).toBe(false);
    expect(normalizeCodeBlockWrap(true)).toBe(true);
    expect(normalizeCodeBlockWrap("true")).toBe(true);
  });

  it("converts rendered inline style strings into React style objects", () => {
    expect(inlineStyleToObject(undefined)).toEqual({});
    expect(inlineStyleToObject("")).toEqual({});
    expect(inlineStyleToObject("background-color:#fee; --organize-x: 4px;;")).toEqual({ backgroundColor: "#fee", "--organize-x": "4px" });
    expect(inlineStyleToObject("color: hsl(0 0% 0% / .5)")).toEqual({ color: "hsl(0 0% 0% / .5)" });
    expect(inlineStyleToObject("broken")).toEqual({});
  });
});

describe("code block selection state and toolbar visibility", () => {
  let editor: Editor;
  afterEach(() => { editor?.destroy(); });
  function createEditor() {
    editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "before" }] },
          { type: "codeBlock", content: [{ type: "text", text: "line 1\nline 2" }] },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      },
    });
    const pos = 8; // paragraph "before" occupies 0..8
    const node = editor.state.doc.nodeAt(pos)!;
    expect(node.type.name).toBe("codeBlock");
    return { pos, nodeSize: node.nodeSize, node };
  }

  it("classifies node selection, caret or range inside, and everything else", () => {
    const { pos, nodeSize } = createEditor();
    const { doc } = editor.state;
    expect(codeBlockSelectionState(NodeSelection.create(doc, pos), pos, nodeSize)).toBe("node");
    expect(codeBlockSelectionState(TextSelection.create(doc, pos + 1), pos, nodeSize)).toBe("inside");
    expect(codeBlockSelectionState(TextSelection.create(doc, pos + 1, pos + nodeSize - 1), pos, nodeSize)).toBe("inside");
    expect(codeBlockSelectionState(TextSelection.create(doc, pos + nodeSize - 1), pos, nodeSize)).toBe("inside");
    expect(codeBlockSelectionState(TextSelection.create(doc, 1), pos, nodeSize)).toBe("none");
    expect(codeBlockSelectionState(TextSelection.create(doc, 2, pos + 3), pos, nodeSize)).toBe("none");
    expect(codeBlockSelectionState(TextSelection.create(doc, pos + 3, pos + nodeSize + 2), pos, nodeSize)).toBe("none");
    expect(codeBlockSelectionState(new AllSelection(doc), pos, nodeSize)).toBe("none");
    expect(codeBlockSelectionState(NodeSelection.create(doc, 0), pos, nodeSize)).toBe("none");
  });

  it("shows for a selected node, for a focused caret, and for read-only carets", () => {
    const base = { state: "inside" as const, selectionEmpty: true, editable: true, editorFocused: true, interacting: false };
    expect(shouldShowCodeBlockToolbar(base)).toBe(true);
    expect(shouldShowCodeBlockToolbar({ ...base, editorFocused: false })).toBe(false);
    expect(shouldShowCodeBlockToolbar({ ...base, editorFocused: false, interacting: true })).toBe(true);
    expect(shouldShowCodeBlockToolbar({ ...base, editorFocused: false, editable: false })).toBe(true);
    expect(shouldShowCodeBlockToolbar({ ...base, selectionEmpty: false })).toBe(false);
    expect(shouldShowCodeBlockToolbar({ ...base, state: "none" })).toBe(false);
    expect(shouldShowCodeBlockToolbar({ ...base, state: "node", selectionEmpty: false, editorFocused: false })).toBe(true);
  });

  it("copies the full text content including newlines, and nothing for other nodes", () => {
    const { node } = createEditor();
    expect(codeBlockCopyText(node)).toBe("line 1\nline 2");
    expect(codeBlockCopyText(editor.state.doc.firstChild!)).toBe("");
  });
});
