import { Extension } from "@tiptap/core";

const STYLED_BLOCKS = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "callout",
  "details",
];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockStyle: {
      setBlockBackground: (pos: number, color: string | null) => ReturnType;
    };
  }
}

export const BlockStyle = Extension.create({
  name: "blockStyle",

  addGlobalAttributes() {
    return [
      {
        types: STYLED_BLOCKS,
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-block-background"),
            renderHTML: (attributes) =>
              attributes.backgroundColor
                ? {
                    "data-block-background": attributes.backgroundColor,
                    style: `background-color:${attributes.backgroundColor};border-radius:6px;`,
                  }
                : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBlockBackground:
        (pos, color) =>
        ({ state, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || !STYLED_BLOCKS.includes(node.type.name)) return false;
          if (dispatch) {
            dispatch(
              state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                backgroundColor: color,
              })
            );
          }
          return true;
        },
    };
  },
});
