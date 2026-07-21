import { Node, mergeAttributes } from "@tiptap/core";

/**
 * 列布局（简化版）：一个 columns 容器包含 N 个 column，每列可放块级内容。
 * 使用 CSS Grid 排版。Notion 的列布局为 Pro 功能，此处为可用的简化实现。
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (cols: number) => ReturnType;
    };
  }
}

export const Column = Node.create({
  name: "column",
  group: "column",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "" }), 0];
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,

  addAttributes() {
    return {
      cols: {
        default: 2,
        parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-cols")) || 2,
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const cols = Number(node.attrs.cols) || 2;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-columns": "",
        "data-cols": String(cols),
        style: `display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:1.25rem;`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      insertColumns:
        (cols: number) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { cols },
            content: Array.from({ length: cols }, () => ({
              type: "column",
              content: [{ type: "paragraph" }],
            })),
          }),
    };
  },
});

export default Columns;
