import type { JSONContent } from "@tiptap/core";

/** 新建后多久内仍为空的笔记，离开时会被视为「误建」自动丢弃 */
export const EMPTY_NOTE_DISCARD_WINDOW_MS = 60 * 60 * 1000;

/** TipTap 文档是否没有任何有意义的内容（只有空段落 / 空标题）。 */
export function isEmptyDoc(doc: JSONContent | null | undefined): boolean {
  if (!doc) return true;
  const walk = (node: JSONContent): boolean => {
    if (node.type === "text") return !(node.text ?? "").trim();
    // 非文本叶子节点（图片、分割线、附件、数据库块等）都算内容
    if (!node.content || node.content.length === 0) {
      return ["doc", "paragraph", "heading"].includes(node.type ?? "");
    }
    return node.content.every(walk);
  };
  return walk(doc);
}

export interface DiscardCheckInput {
  isOwner: boolean;
  loadedEmpty: boolean;
  title: string;
  content: JSONContent | null | undefined;
  hasChildren: boolean;
  createdAt: string | null;
  now?: number;
}

/**
 * 判断离开笔记页时是否应丢弃这篇空笔记。条件全部满足才丢弃：
 * 属主、加载时即为空、当前仍为空（标题与正文）、没有子页面、创建于丢弃窗口内。
 * 任何一项不确定都保留——宁可留一篇空笔记，也不误删用户数据。
 */
export function shouldDiscardEmptyNote(input: DiscardCheckInput): boolean {
  if (!input.isOwner || !input.loadedEmpty || input.hasChildren) return false;
  if (input.title.trim()) return false;
  if (!isEmptyDoc(input.content)) return false;
  if (!input.createdAt) return false;
  const created = Date.parse(input.createdAt);
  if (Number.isNaN(created)) return false;
  return (input.now ?? Date.now()) - created <= EMPTY_NOTE_DISCARD_WINDOW_MS;
}
