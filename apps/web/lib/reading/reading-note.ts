import type { JSONContent } from "@tiptap/core";

export interface ReadingNoteSource {
  id: string;
  title: string | null;
  url: string;
  isInternal: boolean;
}

export interface ReadingNoteHighlight {
  content: string;
  note?: string | null;
}

/** 读书笔记标题：读《文章标题》的笔记（与 seed / 既有笔记命名保持一致） */
export function readingNoteTitle(source: Pick<ReadingNoteSource, "title" | "url">): string {
  const name = (source.title || "").trim() || source.url;
  return `读《${name}》的笔记`;
}

/**
 * 读书笔记初稿：原文链接 + 摘录（高亮与批注）+「我的想法」空段落。
 * 与「全文转为笔记」不同，不复制正文——笔记是读者自己的产出，正文留在阅读库。
 */
export function buildReadingNoteContent(
  source: ReadingNoteSource,
  highlights: ReadingNoteHighlight[]
): JSONContent {
  const href = source.isInternal ? `/library/${source.id}` : source.url;
  const linkText = source.isInternal ? "查看导入物料" : source.url;
  const excerpt: JSONContent[] = highlights.flatMap((h) => {
    const nodes: JSONContent[] = [
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: h.content }] }] },
    ];
    if (h.note?.trim()) {
      nodes.push({ type: "paragraph", content: [{ type: "text", text: `批注：${h.note.trim()}` }] });
    }
    return nodes;
  });
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "原文：" },
          { type: "text", text: linkText, marks: [{ type: "link", attrs: { href, target: "_blank" } }] },
        ],
      },
      ...(excerpt.length
        ? [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "摘录" }] } as JSONContent, ...excerpt]
        : []),
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "我的想法" }] },
      { type: "paragraph" },
    ],
  };
}
