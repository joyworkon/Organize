import type { JSONContent } from "@tiptap/core";
import { BLOCK_ID_TYPES, nodeText } from "@/components/editor/block-utils";

export interface NoteSearchMatch {
  blockId: string | null;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

function buildSnippet(text: string, matchIndex: number, queryLength: number) {
  const radius = 48;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + queryLength + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
  const matchStart = prefix.length + matchIndex - start;
  return {
    snippet,
    matchStart,
    matchEnd: matchStart + queryLength,
  };
}

export function findNoteSearchMatch(
  content: JSONContent | Record<string, unknown> | null,
  query: string
): NoteSearchMatch | null {
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLocaleLowerCase();
  if (!content || !normalizedQuery) return null;

  const matches: Array<NoteSearchMatch & { depth: number; order: number; textLength: number }> = [];
  let order = 0;

  const visit = (node: JSONContent, depth: number) => {
    const currentOrder = order++;
    if (node.type && BLOCK_ID_TYPES.includes(node.type)) {
      const text = nodeText(node);
      const matchIndex = text.toLocaleLowerCase().indexOf(normalizedQuery);
      if (matchIndex >= 0) {
        matches.push({
          blockId: typeof node.attrs?.id === "string" && node.attrs.id ? node.attrs.id : null,
          ...buildSnippet(text, matchIndex, trimmedQuery.length),
          depth,
          order: currentOrder,
          textLength: text.length,
        });
      }
    }
    for (const child of node.content || []) visit(child, depth + 1);
  };

  visit(content as JSONContent, 0);
  matches.sort(
    (left, right) =>
      left.textLength - right.textLength || right.depth - left.depth || left.order - right.order
  );
  const match = matches[0];
  if (!match) return null;
  return {
    blockId: match.blockId,
    snippet: match.snippet,
    matchStart: match.matchStart,
    matchEnd: match.matchEnd,
  };
}
