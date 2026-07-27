function stripHtml(html: string): string {
  const withoutTags = html.replace(/<[^>]*>/g, " ");
  return withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguage(text: string): "zh" | "en" {
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const totalChars = text.replace(/\s/g, "").length;
  if (totalChars === 0) return "en";
  const chineseRatio = chineseChars.length / totalChars;
  return chineseRatio > 0.3 ? "zh" : "en";
}

function countChineseWords(text: string): { chinese: number; english: number } {
  const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const withoutChinese = text.replace(/[\u4e00-\u9fa5]/g, " ");
  const englishWords = withoutChinese.split(/\s+/).filter((w) => w.length > 0).length;
  return { chinese, english: englishWords };
}

function countEnglishWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function estimateReadingTime(html: string, lang?: "zh" | "en"): number {
  const text = stripHtml(html);
  if (text.length === 0) return 1;

  const language = lang || detectLanguage(text);
  let minutes: number;

  if (language === "zh") {
    const { chinese, english } = countChineseWords(text);
    const totalWords = chinese + english;
    minutes = totalWords / 400;
  } else {
    const words = countEnglishWords(text);
    minutes = words / 250;
  }

  const rounded = Math.ceil(minutes);
  return Math.max(1, rounded);
}

export function formatReadingTime(minutes: number): string {
  if (minutes < 1) {
    return "<1 分钟";
  }
  return `${minutes} 分钟`;
}
