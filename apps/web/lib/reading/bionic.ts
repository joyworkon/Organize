/** Presentation-only markup: split source text before escaping HTML entities. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bionicWord(word: string): string {
  if (!word || (/^[\u4e00-\u9fa5]+$/.test(word) && word.length === 1)) return escapeHtml(word);
  const mid = Math.ceil(word.length / 2);
  return `<b>${escapeHtml(word.slice(0, mid))}</b>${escapeHtml(word.slice(mid))}`;
}

export function bionicProcessText(
  text: string,
  segmenter: Intl.Segmenter | null = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("zh-CN", { granularity: "word" })
    : null,
): string {
  if (segmenter) {
    return [...segmenter.segment(text)].map((part) =>
      part.isWordLike && /[\u4e00-\u9fa5a-zA-Z]/.test(part.segment)
        ? bionicWord(part.segment)
        : escapeHtml(part.segment)
    ).join("");
  }
  return text.split(/([\u4e00-\u9fa5]{2,4}|[a-zA-Z]+)/g)
    .map((part, index) => index % 2 ? bionicWord(part) : escapeHtml(part))
    .join("");
}
