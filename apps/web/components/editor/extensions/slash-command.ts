import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { EditorMenuPoint } from "../types";

/**
 * 斜杠菜单与编辑器之间的事件合同（都经 `organize-editor-action` CustomEvent 派发，bubbles）：
 * - `slash-menu`        onStart：打开菜单，焦点留在编辑器；
 * - `slash-menu-update` onUpdate：正文里 "/" 之后继续输入的字符作为查询词，range 覆盖 "/查询词" 全段；
 * - `slash-menu-exit`   onExit：删掉 "/"、光标移出触发范围或打了空格 → 菜单关闭；
 * - `slash-menu-key`    onKeyDown（cancelable）：↑/↓/Enter/Tab 先询问挂载中的行内菜单，
 *   菜单 `preventDefault()` 表示已消费，扩展据此返回 true 吞掉编辑器默认行为（移光标/分段/缩进）。
 *   菜单已被 Esc 关掉时无人消费，这些键恢复正常编辑语义。
 */
export const SLASH_MENU_KEYS = ["ArrowUp", "ArrowDown", "Enter", "Tab"] as const;
export type SlashMenuKey = (typeof SLASH_MENU_KEYS)[number];

export interface SlashMenuRange {
  from: number;
  to: number;
}

export type SlashMenuEventDetail =
  | { type: "slash-menu"; pos: number; range: SlashMenuRange; query: string; nested: boolean; point: EditorMenuPoint }
  | { type: "slash-menu-update"; range: SlashMenuRange; query: string; point?: EditorMenuPoint }
  | { type: "slash-menu-exit" }
  | { type: "slash-menu-key"; key: SlashMenuKey };

function pointFromRect(rect: DOMRect | null | undefined): EditorMenuPoint | undefined {
  if (!rect) return undefined;
  return { left: rect.left, top: rect.bottom + 8, anchorTop: rect.top };
}

function dispatchSlashMenuEvent(dom: HTMLElement, detail: SlashMenuEventDetail, cancelable = false): boolean {
  return dom.dispatchEvent(new CustomEvent("organize-editor-action", { bubbles: true, cancelable, detail }));
}

export const SlashCommand = Extension.create({
  name: "organizeSlashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          // 允许在任何段落中触发，但限制为段落开头附近（最多跟一个字符），
          // 避免普通文本中出现 "/" 时频繁弹出菜单。
          const node = $from.parent;
          if (node.type.name !== "paragraph") return false;
          const textBefore = node.textContent.slice(0, range.from - $from.start());
          return textBefore.length <= 1;
        },
        items: () => [],
        command: () => {},
        render: () => ({
          onStart: ({ editor, range, query, clientRect }) => {
            const $from = editor.state.doc.resolve(range.from);
            // 找到最近的块级节点位置
            let blockPos = range.from;
            let blockDepth = $from.depth;
            while (blockDepth > 0) {
              const node = $from.node(blockDepth);
              if (node.type.isBlock) {
                blockPos = $from.before(blockDepth);
                break;
              }
              blockDepth--;
            }
            dispatchSlashMenuEvent(editor.view.dom, {
              type: "slash-menu",
              pos: blockPos,
              range,
              query: query ?? "",
              nested: $from.depth > 1,
              point: pointFromRect(clientRect?.()) ?? { left: 20, top: 80 },
            });
          },
          onUpdate: ({ editor, range, query, clientRect }) => {
            dispatchSlashMenuEvent(editor.view.dom, {
              type: "slash-menu-update",
              range,
              query: query ?? "",
              point: pointFromRect(clientRect?.()),
            });
          },
          onExit: ({ editor }) => {
            dispatchSlashMenuEvent(editor.view.dom, { type: "slash-menu-exit" });
          },
          onKeyDown: ({ view, event }) => {
            // IME 组合态（中文选词）里的 Enter/方向键属于输入法，不能吞
            if (event.isComposing || event.keyCode === 229) return false;
            if (!(SLASH_MENU_KEYS as readonly string[]).includes(event.key)) return false;
            const consumed = !dispatchSlashMenuEvent(view.dom, { type: "slash-menu-key", key: event.key as SlashMenuKey }, true);
            return consumed;
          },
        }),
      }),
    ];
  },
});
