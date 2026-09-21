import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { BLOCK_ID_TYPES } from "../block-utils";

function isChapterHeading(node: ProseMirrorNode) {
  return node.type.name === "heading" && node.attrs.level === 1;
}

/** Visual grouping only: existing headings and content never get rewritten. */
export function buildSectionCardDecorations(doc: ProseMirrorNode): DecorationSet {
  const blocks: { node: ProseMirrorNode; pos: number }[] = [];
  doc.forEach((node, pos) => blocks.push({ node, pos }));
  const starts = blocks.reduce<number[]>((result, { node }, index) => {
    if (index === 0 || isChapterHeading(node) || node.attrs.sectionStart) result.push(index);
    return result;
  }, []);
  const decorations: Decoration[] = [];
  starts.forEach((start, chapterIndex) => {
    const end = (starts[chapterIndex + 1] ?? blocks.length) - 1;
    for (let index = start; index <= end; index++) {
      const { node, pos } = blocks[index];
      decorations.push(Decoration.node(pos, pos + node.nodeSize, {
        class: ["organize-section-card", index === start && "organize-section-card-first", index === end && "organize-section-card-last"].filter(Boolean).join(" "),
        "data-section-index": String(chapterIndex),
      }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const SectionCardDecorations = Extension.create<{ enabled: () => boolean }>({
  name: "organizeSectionCardDecorations",
  addOptions() { return { enabled: () => false }; },
  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_ID_TYPES, "bulletList", "orderedList", "taskList"],
        attributes: {
          sectionStart: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => element.hasAttribute("data-section-start"),
            renderHTML: (attrs) => attrs.sectionStart ? { "data-section-start": "true" } : {},
          },
        },
      },
      {
        types: ["heading"],
        attributes: {
          sectionLabel: {
            default: "Title",
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-section-label") || "Title",
            renderHTML: (attrs) => attrs.sectionLabel !== "Title" ? { "data-section-label": attrs.sectionLabel } : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: { decorations: (state) => this.options.enabled() ? buildSectionCardDecorations(state.doc) : DecorationSet.empty },
    })];
  },
});
