import { Node, mergeAttributes } from "@tiptap/core";

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
  content: "inline*",
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
    return [{ tag: "div[data-callout]" }];
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

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.setNode(this.name, attrs),
      toggleCallout:
        (attrs) =>
        ({ commands }) =>
          commands.toggleNode(this.name, "paragraph", attrs),
    };
  },
});

export default Callout;
