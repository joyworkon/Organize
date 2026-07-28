export interface ExtractedLink {
  url: string;
  type: "external" | "note" | "reading";
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
            const noteId = href.split("/notes/")[1]?.split(/[?#]/)[0];
            if (noteId) links.push({ url: noteId, type: "note" });
          } else if (href.includes("/library/")) {
            const itemId = href.split("/library/")[1]?.split(/[?#]/)[0];
            if (itemId) links.push({ url: itemId, type: "reading" });
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
