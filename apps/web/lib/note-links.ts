export interface ExtractedLink {
  url: string;
  type: "external" | "note" | "reading";
}

export type InternalLinkState = "active" | "deleted" | "missing";

export interface InternalLinkStateRow {
  resource_type: "note" | "reading";
  resource_id: string;
  title: string | null;
  state: InternalLinkState;
}

export function internalLinkKey(type: "note" | "reading", id: string): string {
  return `${type}:${id}`;
}

function decodeInternalId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function internalLinkKeyFromHref(href: string): string | null {
  const noteId = href.match(/\/notes\/([^/?#]+)/)?.[1];
  if (noteId) return internalLinkKey("note", decodeInternalId(noteId));
  const readingId = href.match(/\/library\/([^/?#]+)/)?.[1];
  if (readingId) return internalLinkKey("reading", decodeInternalId(readingId));
  return null;
}

export function extractLinksFromContent(content: any): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  if (!content || !content.content) return links;

  function traverse(node: any) {
    if (node.marks) {
      for (const mark of node.marks) {
        if (mark.type === "link" && mark.attrs?.href) {
          const href = mark.attrs.href;
          if (href.includes("/notes/")) {
            const noteId = href.match(/\/notes\/([^/?#]+)/)?.[1];
            if (noteId) links.push({ url: decodeInternalId(noteId), type: "note" });
          } else if (href.includes("/library/")) {
            const itemId = href.match(/\/library\/([^/?#]+)/)?.[1];
            if (itemId) links.push({ url: decodeInternalId(itemId), type: "reading" });
          } else {
            links.push({ url: href, type: "external" });
          }
        }
      }
    }
    if (node.content) {
      for (const child of node.content) traverse(child);
    }
  }

  traverse(content);
  const seen = new Set<string>();
  return links.filter((l) => {
    const key = `${l.type}:${l.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
