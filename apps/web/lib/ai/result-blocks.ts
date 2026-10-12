import type { JSONContent } from "@tiptap/core";
import { markdownToTiptapBlocks } from "@/lib/import/markdown-to-tiptap";

/**
 * AI 文本结果 → 编辑器区块。
 * 模型（如 MiMo、GPT）常返回 Markdown（## 标题、**加粗**、列表）；直接塞进一个段落会显示成原始符号。
 * 这里按 Markdown 解析成正式的标题 / 列表 / 加粗等节点；解析失败或为空时退回纯文本段落（按空行分段）。
 */
export function aiResultToBlocks(text: string): JSONContent[] {
  const value = text.trim();
  if (!value) return [];
  try {
    const content = (markdownToTiptapBlocks(value.slice(0, 20_000)) as JSONContent[]).filter(Boolean);
    // 无 DOM 等环境下解析会得到空段落：没有任何文字就视为失败
    if (content.length > 0 && JSON.stringify(content).includes('"text"')) return content;
  } catch {
    /* 退回纯文本 */
  }
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ type: "paragraph", content: [{ type: "text", text: part }] }));
}
