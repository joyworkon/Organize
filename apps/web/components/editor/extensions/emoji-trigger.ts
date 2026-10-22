import { Extension, type Editor, type Range } from "@tiptap/core";
import type { ResolvedPos } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { findEmojiByShortcode } from "@/lib/editor/emoji-catalog";
import type { EditorMenuPoint } from "../types";

export const emojiSuggestPluginKey = new PluginKey("organizeEmojiSuggest");
export const emojiShortcodePluginKey = new PluginKey("organizeEmojiShortcode");
export type EmojiSuggestEvent =
  | { type: "start" | "update"; range: Range; query: string; point: EditorMenuPoint }
  | { type: "exit" }
  | { type: "key"; key: string };

function dispatch(editor: Editor, detail: EmojiSuggestEvent, cancelable = false) {
  return editor.view.dom.dispatchEvent(new CustomEvent("organize-emoji-suggest", { bubbles: true, cancelable, detail }));
}

/**
 * `:关键词` 的触发判定（纯函数，供单测）：行首、空白或标点（含 CJK 标点）之后的 `:` 才触发，
 * 查询为 1–20 个非空非冒号字符。`:` 前是字母/数字（`12:30`、`http://`）、或紧跟空格时不匹配。
 */
export function findEmojiTriggerMatch(before: string): { text: string; query: string } | null {
  const match = /(?:^|[\s\p{P}])(:([^\s:\ufffc]{1,20}))$/u.exec(before);
  return match ? { text: match[1], query: match[2] } : null;
}

/**
 * 收尾冒号判定（纯函数，供 :fire: 直替换）：入参为光标前文本加上刚输入的 `:`。
 * 命中时返回整段 `:短码:` 的长度与短码本体；前缀规则与触发判定一致。
 */
export function findEmojiShortcodeClose(textWithClosingColon: string): { length: number; query: string } | null {
  const match = /(?:^|[\s\p{P}])(:([^\s:\ufffc]{1,20}):)$/u.exec(textWithClosingColon);
  return match ? { length: match[1].length, query: match[2] } : null;
}

function findEmojiSuggestionMatch($position: ResolvedPos) {
  const before = $position.parent.textBetween(0, $position.parentOffset, "\n", "\ufffc");
  const match = findEmojiTriggerMatch(before);
  if (!match) return null;
  return { range: { from: $position.pos - match.text.length, to: $position.pos }, query: match.query, text: match.text };
}

/** 纯文本替换 `:关键词`：与页面链接一致，不引入新节点或保存协议。 */
export function insertEmoji(editor: Editor, range: Range, emoji: string): boolean {
  if (!editor.isEditable || editor.isDestroyed || !emoji) return false;
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.to > editor.state.doc.content.size || range.from >= range.to) return false;
  if (editor.state.selection.from !== range.to || !editor.state.selection.empty) return false;
  const match = findEmojiSuggestionMatch(editor.state.doc.resolve(range.to));
  if (!match || match.range.from !== range.from) return false;
  return editor.chain().focus().command(({ tr }) => {
    // 插入 emoji 与输入短码分成两步撤销（与插入页面链接一致）
    closeHistory(tr);
    return true;
  }).insertContentAt(range, emoji).run();
}

/** 代码块 / 行内代码 / 公式等 code 上下文不触发也不替换（与页面链接的 allow 判定一致） */
function isEmojiAllowed(editor: Editor, state: Editor["state"], from: number, to: number): boolean {
  if (!editor.isEditable) return false;
  const parent = state.doc.resolve(from).parent;
  if (!["paragraph", "heading"].includes(parent.type.name)) return false;
  let code = (state.storedMarks ?? state.selection.$from.marks()).some((mark) => mark.type.name === "code");
  state.doc.nodesBetween(from, to, (node) => {
    if (node.marks.some((mark) => mark.type.name === "code")) code = true;
  });
  return !code;
}

export const EmojiSuggestTrigger = Extension.create({
  name: "organizeEmojiSuggestTrigger",
  addProseMirrorPlugins() {
    const editor = this.editor;
    const notify = (type: "start" | "update", range: Range, query: string) => {
      const current = emojiSuggestPluginKey.getState(editor.state);
      if (!current?.active || current.query !== query || current.range.from !== range.from || current.range.to !== range.to || !editor.isEditable) return;
      const rect = editor.view.coordsAtPos(range.to);
      dispatch(editor, { type, range, query, point: { left: rect.left, top: rect.bottom + 8, anchorTop: rect.top } });
    };
    return [
      Suggestion({
        editor,
        pluginKey: emojiSuggestPluginKey,
        char: ":",
        allowedPrefixes: null,
        // 自定义匹配器强制前缀规则（行首/空白/标点），并排除 URL 与时间写法
        findSuggestionMatch: ({ $position }) => findEmojiSuggestionMatch($position),
        allow: ({ state, range }) => isEmojiAllowed(editor, state, range.from, range.to),
        items: () => [],
        command: () => {},
        render: () => ({
          onStart: ({ range, query }) => notify("start", range, query),
          onUpdate: ({ range, query }) => notify("update", range, query),
          onExit: () => { dispatch(editor, { type: "exit" }); },
          onKeyDown: ({ event }) => {
            if (event.isComposing || event.keyCode === 229) return false;
            if (!["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) return false;
            return !dispatch(editor, { type: "key", key: event.key }, true);
          },
        }),
      }),
      // 输入完整短码再敲 `:`（如 :fire:）直接替换为 emoji；未命中短码时放行，不吞字符
      new Plugin({
        key: emojiShortcodePluginKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== ":" || from !== to) return false;
            const $from = view.state.doc.resolve(from);
            if (!isEmojiAllowed(editor, view.state, from, from)) return false;
            const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
            const candidate = findEmojiShortcodeClose(before + ":");
            if (!candidate) return false;
            const option = findEmojiByShortcode(candidate.query);
            if (!option) return false;
            // 收尾冒号尚未进文档：替换已输入的 `:短码` 部分并吞掉这次冒号输入
            const replaceFrom = from - (candidate.length - 1);
            if (!isEmojiAllowed(editor, view.state, replaceFrom, from)) return false;
            const tr = view.state.tr.insertText(option.emoji, replaceFrom, from);
            closeHistory(tr);
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
