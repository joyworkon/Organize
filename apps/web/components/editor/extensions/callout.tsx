import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";

const EMOJI_OPTIONS = ["💡", "⚠️", "📌", "✅", "❌", "🔥", "💪", "📖", "🎯", "⭐", "🚀", "💯", "❗", "❓", "📝", "🎉", "❤️", "👍", "👎", "💬", "🤔", "😂", "😭", "😡"];

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emoji = (node.attrs.emoji as string) || "💡";

  return (
    <NodeViewWrapper
      as="div"
      data-callout=""
      data-emoji={emoji}
    >
      <span
        className="callout-emoji"
        contentEditable={false}
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        title="点击更换图标"
      >
        {emoji}
      </span>
      <NodeViewContent className="callout-content" as="div" />
      {showEmojiPicker && (
        <div
          contentEditable={false}
          className="callout-emoji-picker"
          onMouseLeave={() => setShowEmojiPicker(false)}
        >
          {EMOJI_OPTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                updateAttributes({ emoji: e });
                setShowEmojiPicker(false);
                editor.commands.focus();
              }}
              className={e === emoji ? "active" : ""}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * 标注（Callout）块：带 emoji 图标的提示块，参考 Notion 的 Callout。
 * 结构：div[data-callout] > span.callout-emoji + div.callout-content(内容洞)
 */
export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
      toggleCallout: (attrs?: { emoji?: string }) => ReturnType;
    };
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-emoji") || "💡",
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]", contentElement: ".callout-content" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-callout": "",
        "data-emoji": node.attrs.emoji,
      }),
      ["span", { class: "callout-emoji", contenteditable: "false" }, node.attrs.emoji],
      ["div", { class: "callout-content" }, 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attrs),
    };
  },
});

export default Callout;
