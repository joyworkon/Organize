import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type OrderedListStyle = "default" | "decimal" | "lower-alpha" | "lower-roman";
export type BulletListStyle = "default" | "disc" | "circle" | "square";
export type ListStyle = OrderedListStyle | BulletListStyle;

const LIST_TYPES = new Set(["bulletList", "orderedList"]);
const ORDERED_LIST_STYLES = new Set<OrderedListStyle>([
  "default",
  "decimal",
  "lower-alpha",
  "lower-roman",
]);
const BULLET_LIST_STYLES = new Set<BulletListStyle>([
  "default",
  "disc",
  "circle",
  "square",
]);

function isCompatibleStyle(
  type: "bulletList" | "orderedList",
  style: string
): style is ListStyle {
  return type === "orderedList"
    ? ORDERED_LIST_STYLES.has(style as OrderedListStyle)
    : BULLET_LIST_STYLES.has(style as BulletListStyle);
}

export const ListStyleExtension = Extension.create({
  name: "listStyle",

  addGlobalAttributes() {
    return [
      {
        types: ["bulletList", "orderedList"],
        attributes: {
          listStyle: {
            default: "default",
            parseHTML: (element) => {
              const value = element.getAttribute("data-list-style");
              const type = element.tagName === "OL" ? "orderedList" : "bulletList";
              return value && isCompatibleStyle(type, value) ? value : "default";
            },
            renderHTML: (attributes) =>
              attributes.listStyle && attributes.listStyle !== "default"
                ? { "data-list-style": attributes.listStyle }
                : {},
          },
        },
      },
    ];
  },
});

export interface ListParent {
  node: ProseMirrorNode;
  pos: number;
  type: "bulletList" | "orderedList";
  style: ListStyle;
}

export function findListParent(
  doc: ProseMirrorNode,
  targetPos: number
): ListParent | null {
  const direct = doc.nodeAt(targetPos);
  if (direct && LIST_TYPES.has(direct.type.name)) {
    return {
      node: direct,
      pos: targetPos,
      type: direct.type.name as ListParent["type"],
      style: (direct.attrs.listStyle || "default") as ListStyle,
    };
  }

  const resolvedPos = Math.min(Math.max(targetPos + 1, 0), doc.content.size);
  const $pos = doc.resolve(resolvedPos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!LIST_TYPES.has(node.type.name)) continue;
    return {
      node,
      pos: $pos.before(depth),
      type: node.type.name as ListParent["type"],
      style: (node.attrs.listStyle || "default") as ListStyle,
    };
  }
  return null;
}

export function setListStyle(
  editor: Editor,
  targetPos: number,
  style: ListStyle
): boolean {
  const list = findListParent(editor.state.doc, targetPos);
  if (!list || !isCompatibleStyle(list.type, style)) return false;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(list.pos, undefined, {
      ...list.node.attrs,
      listStyle: style,
    })
  );
  editor.commands.focus();
  return true;
}
