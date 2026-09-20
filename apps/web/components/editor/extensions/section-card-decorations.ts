import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface TopLevelBlock {
  node: ProseMirrorNode;
  pos: number;
}

function isChapterHeading(node: ProseMirrorNode) {
  return node.type.name === "heading" && node.attrs.level === 1;
}

/** Derive visual chapter cards without changing the serialized note JSON. */
export function buildSectionCardDecorations(doc: ProseMirrorNode): DecorationSet {
  const blocks: TopLevelBlock[] = [];
  doc.forEach((node, offset) => blocks.push({ node, pos: offset }));
  if (!blocks.length) return DecorationSet.empty;

  const starts = blocks.reduce<number[]>((result, block, index) => {
    if (index === 0 || isChapterHeading(block.node)) result.push(index);
    return result;
  }, []);
  const decorations: Decoration[] = [];

  starts.forEach((startIndex, chapterIndex) => {
    const endIndex = (starts[chapterIndex + 1] ?? blocks.length) - 1;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const block = blocks[index];
      const first = index === startIndex;
      const last = index === endIndex;
      decorations.push(
        Decoration.node(block.pos, block.pos + block.node.nodeSize, {
          class: [
            "organize-section-card",
            first ? "organize-section-card-first" : "",
            last ? "organize-section-card-last" : "",
          ].filter(Boolean).join(" "),
          "data-section-index": String(chapterIndex),
        })
      );

      if (first && isChapterHeading(block.node)) {
        decorations.push(
          Decoration.widget(
            block.pos + block.node.nodeSize - 1,
            () => {
              const suffix = document.createElement("span");
              suffix.className = "organize-section-heading-suffix";
              suffix.contentEditable = "false";
              suffix.setAttribute("aria-hidden", "true");

              const brace = document.createElement("span");
              brace.className = "organize-section-heading-brace";
              brace.textContent = "}";

              const label = document.createElement("span");
              label.className = "organize-section-heading-label";
              label.textContent = "INTRODUCTION  ↗";

              suffix.append(brace, label);
              return suffix;
            },
            { key: `section-heading-${block.pos}`, side: 1 }
          )
        );
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const SectionCardDecorations = Extension.create({
  name: "organizeSectionCardDecorations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => buildSectionCardDecorations(state.doc),
        },
      }),
    ];
  },
});
