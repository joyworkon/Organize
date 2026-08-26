import { definePlugin } from "@organize/plugin-sdk";
import type { ScrapeResult } from "@organize/shared";

// 简单的关键词提取逻辑（基于词频）
function extractKeywords(text: string, maxTags: number): string[] {
  // 移除 HTML 标签
  const cleanText = text.replace(/<[^>]*>/g, " ");

  // 中文分词（简单按标点和空格分割）+ 英文单词
  const words = cleanText
    .replace(/[^\w\u4e00-\u9fa5]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && w.length <= 10);

  // 统计词频
  const freq: Record<string, number> = {};
  const stopWords = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
    "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
    "this", "that", "these", "those", "it", "its", "they", "them",
  ]);

  for (const word of words) {
    const lower = word.toLowerCase();
    if (!stopWords.has(lower)) {
      freq[lower] = (freq[lower] || 0) + 1;
    }
  }

  // 按词频排序取前 N 个
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTags)
    .map(([word]) => word);
}

const tagSuggestPlugin = definePlugin({
  id: "tag-suggest",
  name: "标签推荐",
  version: "0.2.0",
  description: "根据文章内容自动推荐标签，支持关键词提取和分类建议",
  author: "Organize Team",
  icon: "🏷️",
  configFields: [
    {
      key: "maxTags",
      label: "最大推荐标签数",
      type: "number",
      default: 5,
    },
    {
      key: "autoApply",
      label: "自动应用推荐标签",
      type: "boolean",
      default: false,
    },
  ],
  onActivate: (ctx) => {
    ctx.registerCommand?.({
      id: "suggest-tags-for-current-item",
      title: "为当前阅读条目推荐标签",
      icon: "🏷️",
      keywords: ["tag", "标签", "推荐", "关键词"],
      handler: (commandCtx) => {
        const item = commandCtx.getCurrentItem();
        if (!item) {
          commandCtx.notify("请先打开一篇阅读条目，再执行本命令", "info");
          return;
        }
        const config = commandCtx.getConfig<{ maxTags?: number }>();
        const textToAnalyze = `${item.title || ""} ${item.excerpt || ""} ${item.content || ""}`;
        const tags = extractKeywords(textToAnalyze, config.maxTags || 5);
        if (tags.length > 0) {
          commandCtx.notify(`推荐标签: ${tags.join(", ")}`, "success");
        } else {
          commandCtx.notify("未能提取到有效标签", "info");
        }
      },
    });
  },
  extensions: [
    {
      type: "content-processor",
      id: "tag-suggest-processor",
      label: "自动标签推荐",
      handler: async (result: ScrapeResult, ctx) => {
        const config = ctx.getConfig<{ maxTags?: number }>();
        const maxTags = config.maxTags || 5;

        const textToAnalyze = `${result.title} ${result.excerpt} ${result.content || ""}`;
        const tags = extractKeywords(textToAnalyze, maxTags);

        if (tags.length > 0) {
          ctx.notify(`推荐标签: ${tags.join(", ")}`, "info");
        }

        return result;
      },
    },
    {
      type: "toolbar-action",
      id: "tag-suggest-action",
      label: "推荐标签",
      icon: "🏷️",
      handler: async (ctx) => {
        const item = ctx.getCurrentItem();
        if (!item) {
          ctx.notify("没有可分析的内容", "error");
          return;
        }

        const config = ctx.getConfig<{ maxTags?: number }>();
        const maxTags = config.maxTags || 5;
        const textToAnalyze = `${item.title || ""} ${item.excerpt || ""} ${item.content || ""}`;
        const tags = extractKeywords(textToAnalyze, maxTags);

        if (tags.length > 0) {
          ctx.notify(`推荐标签: ${tags.join(", ")}`, "success");
        } else {
          ctx.notify("未能提取到有效标签", "info");
        }
      },
    },
  ],
});

export default tagSuggestPlugin;
