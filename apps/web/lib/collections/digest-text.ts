/**
 * HTML → 纯文本提取（阶段 4 整理稿的来源正文预处理）。
 * 去标签、解实体、折叠空白；不做任何截断（预算层负责明确拒绝）。
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…",
  mdash: "—", ndash: "–", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  copy: "©", reg: "®", trade: "™", middot: "·",
};

export function stripHtmlToText(html: string): string {
  if (!html) return "";
  return decodeEntities(
    html
      // 块级边界转空白，防止单词粘连
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}
