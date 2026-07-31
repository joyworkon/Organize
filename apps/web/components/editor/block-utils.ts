import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export const BLOCK_ID_TYPES = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "image",
  "table",
  "details",
  "callout",
  "mathBlock",
  "columns",
  "htmlEmbed",
  "fileAttachment",
  "tableOfContents",
  "breadcrumb",
  "buttonBlock",
  "tabs",
  "mermaid",
  "embed",
];

export const ALLOWED_AI_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "details",
  "detailsSummary",
  "detailsContent",
  "callout",
  "text",
]);

export function nodeText(node: ProseMirrorNode | JSONContent): string {
  if ("textContent" in node) return node.textContent;
  if (typeof node.text === "string") return node.text;
  return (node.content || []).map(nodeText).join(" ").replace(/\s+/g, " ").trim();
}

export function stripBlockIds<T extends JSONContent>(node: T): T {
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  if (attrs && "id" in attrs) attrs.id = null;
  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(node.content ? { content: node.content.map((child) => stripBlockIds(child)) } : {}),
  } as T;
}

export function findBlockById(
  doc: ProseMirrorNode,
  blockId: string
): { node: ProseMirrorNode; pos: number } | null {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (node.attrs?.id === blockId) {
      found = { node, pos };
      return false;
    }
    return !found;
  });
  return found;
}

/** Build a transaction that moves one complete sibling block without changing its content. */
export function moveBlockTransaction(
  state: EditorState,
  sourcePos: number,
  targetInsertPos: number
): Transaction | null {
  const sourceNode = state.doc.nodeAt(sourcePos);
  if (!sourceNode) return null;
  const sourceEnd = sourcePos + sourceNode.nodeSize;
  if (targetInsertPos === sourcePos || targetInsertPos === sourceEnd) return null;

  const insertPos = targetInsertPos > sourceEnd
    ? targetInsertPos - sourceNode.nodeSize
    : targetInsertPos;
  return state.tr
    .delete(sourcePos, sourceEnd)
    .insert(insertPos, sourceNode)
    .scrollIntoView();
}

function canonicalizeJSON(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJSON);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeJSON(child)])
    );
  }
  return value;
}

/** Compare editor nodes by value, independent of JSONB/object key ordering. */
export function isSameNodeSnapshot(left: JSONContent, right: JSONContent): boolean {
  return JSON.stringify(canonicalizeJSON(left)) === JSON.stringify(canonicalizeJSON(right));
}

export function isAllowedAIContent(content: JSONContent[]): boolean {
  const visit = (node: JSONContent): boolean =>
    Boolean(node.type && ALLOWED_AI_NODE_TYPES.has(node.type)) &&
    (node.content || []).every(visit);
  return content.length > 0 && content.every(visit);
}

export interface PresentationSlide {
  id: string;
  title: string;
  content: JSONContent[];
}

export function buildPresentationSlides(
  doc: JSONContent,
  startBlockId?: string
): PresentationSlide[] {
  const blocks = doc.content || [];
  // 起始块可能嵌套在列表等顶层块内部；此时从包含它的顶层块开始演示。
  const containsBlockId = (node: JSONContent): boolean =>
    node.attrs?.id === startBlockId || Boolean(node.content?.some(containsBlockId));
  const startIndex = startBlockId
    ? Math.max(0, blocks.findIndex(containsBlockId))
    : 0;
  const selected = blocks.slice(startIndex);
  const slides: PresentationSlide[] = [];

  for (const block of selected) {
    const isSection = block.type === "heading" && [1, 2].includes(Number(block.attrs?.level));
    if (isSection || slides.length === 0) {
      slides.push({
        id: String(block.attrs?.id || `slide-${slides.length + 1}`),
        title: isSection ? nodeText(block) || "未命名章节" : "",
        content: isSection ? [] : [block],
      });
    } else {
      slides[slides.length - 1].content.push(block);
    }
  }

  return slides.length ? slides : [{ id: "empty", title: "空白笔记", content: [] }];
}
