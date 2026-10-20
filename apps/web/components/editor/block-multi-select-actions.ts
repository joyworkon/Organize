import type { Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { BLOCK_COMMANDS } from "./block-commands";
import { TEXT_TRANSFORMABLE_TYPES } from "./block-action-options";
import { BLOCK_BACKGROUND_TYPES } from "./extensions/block-style";
import { getMultiSelectedBlocks, setMultiSelectedBlocks } from "./extensions/block-multi-select";

/** Ignore stale positions and descendants already covered by an outer selected block. */
export function selectedBlocks(doc: ProseMirrorNode, positions: number[]) {
  const blocks: { pos: number; node: ProseMirrorNode }[] = [];
  for (const pos of [...new Set(positions)].sort((a, b) => a - b)) {
    if (!Number.isInteger(pos) || pos < 0 || pos >= doc.content.size) continue;
    const $pos = doc.resolve(pos);
    const node = $pos.nodeAfter;
    if ($pos.textOffset || !node?.isBlock) continue;
    const previous = blocks.at(-1);
    if (previous && pos < previous.pos + previous.node.nodeSize) continue;
    blocks.push({ pos, node });
  }
  return blocks;
}

export function contiguousBlockGroup(doc: ProseMirrorNode, positions: number[]) {
  const blocks = selectedBlocks(doc, positions);
  if (!blocks.length) return null;
  const $first = doc.resolve(blocks[0].pos);
  let end = blocks[0].pos;
  for (const block of blocks) {
    const $pos = doc.resolve(block.pos);
    if (block.pos !== end || !$pos.sameParent($first)) return null;
    end += block.node.nodeSize;
  }
  return { blocks, from: blocks[0].pos, to: end, parent: $first.parent, depth: $first.depth, index: $first.index() };
}

function commit(editor: Editor, tr: Transaction, positions: number[]) {
  if (!tr.docChanged) return false;
  // Keep each toolbar action separate from preceding typing and the next toolbar action.
  editor.view.dispatch(closeHistory(tr).scrollIntoView());
  // UniqueID may append a document transaction; restore metadata only after it completes.
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.view.focus();
  setMultiSelectedBlocks(editor, [...new Set(positions)].sort((a, b) => a - b));
  return true;
}

export function transformSelectedBlocks(editor: Editor, commandId: string) {
  const blocks = selectedBlocks(editor.state.doc, getMultiSelectedBlocks(editor));
  const skipped = blocks.filter(({ node }) => !TEXT_TRANSFORMABLE_TYPES.has(node.type.name)).length;
  const command = BLOCK_COMMANDS.find((item) => item.id === commandId && item.canTransform);
  // Page conversion opens an asynchronous dialog and cannot join an atomic document edit.
  if (!editor.isEditable || editor.isDestroyed || !command || command.id === "page") return { applied: false, skipped };
  const tr = editor.state.tr;
  for (const { pos, node } of [...blocks].reverse()) {
    if (!TEXT_TRANSFORMABLE_TYPES.has(node.type.name)) continue;
    command.run(editor, pos, tr);
  }
  const positions = blocks.map(({ pos }) => {
    const mapped = tr.mapping.map(pos, -1);
    const $mapped = tr.doc.resolve(mapped);
    // Joining adjacent lists maps the original boundary inside the resulting list.
    return $mapped.depth ? $mapped.before(1) : mapped;
  });
  return { applied: commit(editor, tr, positions), skipped };
}

export function colorSelectedBlocks(editor: Editor, kind: "text" | "background", value: string | null) {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const blocks = selectedBlocks(editor.state.doc, getMultiSelectedBlocks(editor));
  const tr = editor.state.tr;
  for (const { pos, node } of [...blocks].reverse()) {
    if (kind === "background") {
      if (BLOCK_BACKGROUND_TYPES.has(node.type.name)) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: value });
      } else {
        // Lists have no background attribute; color their list items instead.
        node.descendants((child, offset) => {
          if (!BLOCK_BACKGROUND_TYPES.has(child.type.name)) return true;
          tr.setNodeMarkup(pos + 1 + offset, undefined, { ...child.attrs, backgroundColor: value });
          return false;
        });
      }
    } else {
      const textStyle = editor.schema.marks.textStyle;
      if (!textStyle) continue;
      node.descendants((child, offset, parent) => {
        if (!child.isText || !parent?.type.allowsMarkType(textStyle)) return;
        const from = pos + 1 + offset;
        const existing = child.marks.find((mark) => mark.type === textStyle);
        const attrs = { ...existing?.attrs, color: value };
        tr.removeMark(from, from + child.nodeSize, textStyle);
        if (Object.values(attrs).some((attribute) => attribute != null && attribute !== "")) {
          tr.addMark(from, from + child.nodeSize, textStyle.create(attrs));
        }
      });
    }
  }
  return commit(editor, tr, blocks.map(({ pos }) => pos));
}

export function moveSelectedBlocks(editor: Editor, direction: -1 | 1) {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const group = contiguousBlockGroup(editor.state.doc, getMultiSelectedBlocks(editor));
  if (!group) return false;
  const neighborIndex = direction < 0 ? group.index - 1 : group.index + group.blocks.length;
  if (neighborIndex < 0 || neighborIndex >= group.parent.childCount) return false;
  const neighbor = group.parent.child(neighborIndex);
  const nodes = group.blocks.map(({ node }) => node);
  const replacement = Fragment.fromArray(direction < 0 ? [...nodes, neighbor] : [neighbor, ...nodes]);
  const from = direction < 0 ? group.from - neighbor.nodeSize : group.from;
  const to = direction < 0 ? group.to : group.to + neighbor.nodeSize;
  const tr = editor.state.tr.replaceWith(from, to, replacement);
  const shift = direction * neighbor.nodeSize;
  return commit(editor, tr, group.blocks.map(({ pos }) => pos + shift));
}

export function wrapSelectedBlocks(editor: Editor, kind: "callout" | "details") {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const group = contiguousBlockGroup(editor.state.doc, getMultiSelectedBlocks(editor));
  if (!group || group.depth !== 0 || !editor.schema.nodes[kind]) return false;
  const content = Fragment.fromArray(group.blocks.map(({ node }) => node));
  let wrapper: ProseMirrorNode;
  if (kind === "callout") {
    wrapper = editor.schema.nodes.callout.create({ emoji: "💡" }, content);
  } else {
    // Summary is a short copy. Keep ALL original blocks in content, including their IDs/marks.
    const summary = group.blocks.length > 1 ? group.blocks[0].node.textContent.slice(0, 80) : "";
    wrapper = editor.schema.nodes.details.create(null, [
      editor.schema.nodes.detailsSummary.create(null, summary ? editor.schema.text(summary) : undefined),
      editor.schema.nodes.detailsContent.create(null, content),
    ]);
  }
  wrapper.check();
  return commit(editor, editor.state.tr.replaceWith(group.from, group.to, wrapper), [group.from]);
}

export { selectionNeedsDeleteConfirmation, deleteSelectedBlocksWithConfirmation } from "./extensions/block-multi-select";
