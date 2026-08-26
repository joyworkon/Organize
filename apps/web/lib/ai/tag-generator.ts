/**
 * 标签生成器接口
 *
 * 设计：把"如何生成标签"和"何时生成标签"解耦。
 * - 默认实现：关键词提取（本地、零成本）
 * - AI 实现：OpenAI 兼容协议，配置来自「设置 › AI 服务」（user_ai_settings），
 *   未配置时回退环境变量；AI 失败时业务层降级回关键词。
 */

import { chatCompletion, type AIConfig } from "./server";

export interface TagSuggestion {
  /** 标签名 */
  name: string;
  /** 置信度 0-1（关键词提取用词频归一化，AI 用模型自报） */
  score: number;
  /** 来源：keyword / ai */
  source: "keyword" | "ai";
}

export interface TagGeneratorInput {
  /** 资源类型 */
  resourceType: "note" | "reading_item";
  /** 标题 */
  title: string;
  /** 用于提取标签的文本（已去 HTML 标签的纯文本） */
  text: string;
  /** 用户已有的标签名（用于优先复用而非新建） */
  existingTagNames: string[];
  /** 最大返回数量 */
  maxTags?: number;
}

export interface TagGenerator {
  generate(input: TagGeneratorInput): Promise<TagSuggestion[]>;
}

// ---------- 默认实现：关键词提取 ----------

const STOP_WORDS = new Set([
  // 中文虚词
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
  "没有", "看", "好", "自己", "这", "他", "她", "它", "们", "那", "些",
  "什么", "怎么", "这个", "那个", "可以", "因为", "所以", "如果", "但是",
  "可能", "需要", "已经", "现在", "时候", "地方", "东西",
  // 英文常见
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "and", "but", "or", "not", "so", "this", "that", "it", "its", "they",
  "them", "their", "we", "you", "your", "he", "she", "his", "her",
]);

/**
 * 从纯文本提取关键词（基于词频 + 长度过滤）
 * 对中文不友好（没分词），但作为默认零成本实现够用。
 * 接入 AI 后会被替代。
 */
function extractKeywords(text: string, maxTags: number): TagSuggestion[] {
  // 去掉 HTML 残留
  const clean = text.replace(/<[^>]*>/g, " ");
  // 拆词：中文字符段 + 英文单词
  const tokens = clean
    .replace(/[^\w\u4e00-\u9fa5]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const freq = new Map<string, number>();
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    // 过滤：太短 / 太长 / 停用词
    if (lower.length < 2 || lower.length > 16) continue;
    if (STOP_WORDS.has(lower)) continue;
    // 过滤纯数字
    if (/^\d+$/.test(lower)) continue;
    freq.set(lower, (freq.get(lower) || 0) + 1);
  }

  // 只出现 1 次的词意义不大，过滤掉（除非整体词很少）
  const minFreq = freq.size > 20 ? 2 : 1;
  const sorted = Array.from(freq.entries())
    .filter(([, c]) => c >= minFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTags);

  if (sorted.length === 0) return [];
  const maxCount = sorted[0][1];
  return sorted.map(([name, count]) => ({
    name,
    score: maxCount === 0 ? 0 : count / maxCount,
    source: "keyword" as const,
  }));
}

/**
 * 默认标签生成器：关键词提取
 */
export const keywordTagGenerator: TagGenerator = {
  async generate(input) {
    const max = input.maxTags ?? 5;
    const fullText = `${input.title}\n${input.text}`.slice(0, 10000); // 截断防止超长
    const suggestions = extractKeywords(fullText, max);

    // 如果用户已有标签，优先匹配已有的（避免创建一堆同义标签）
    const existing = new Set(input.existingTagNames.map((n) => n.toLowerCase()));
    return suggestions.map((s) => {
      if (existing.has(s.name.toLowerCase())) {
        return { ...s, score: Math.min(1, s.score + 0.2) }; // 略提优先级
      }
      return s;
    });
  },
};

// ---------- AI 实现（OpenAI 兼容协议） ----------

/**
 * 用用户配置的 AI 服务生成标签。
 * 让模型返回严格 JSON，解析失败时抛错，由业务层降级到关键词生成器。
 */
export function createAITagGenerator(config: AIConfig): TagGenerator {
  return {
    async generate(input) {
      const max = input.maxTags ?? 5;
      const raw = await chatCompletion(
        config,
        "根据文章内容推荐标签。要求：2-8 个字符的简短词；优先复用用户已有标签；" +
          "只输出严格 JSON：{\"tags\":[{\"name\":\"标签名\",\"score\":0.9}]}，score 为 0-1 置信度。",
        `标题：${input.title}\n已有标签：${input.existingTagNames.join(", ") || "（无）"}\n内容：${input.text.slice(0, 3000)}`
      );
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("AI 未返回 JSON");
      const parsed = JSON.parse(match[0]);
      const tags = Array.isArray(parsed?.tags) ? parsed.tags : [];
      const suggestions: TagSuggestion[] = [];
      for (const tag of tags) {
        const name = String(tag?.name || "").trim().replace(/^#/, "");
        if (!name || name.length > 16) continue;
        const score = Number(tag?.score);
        suggestions.push({
          name,
          score: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0.5,
          source: "ai",
        });
        if (suggestions.length >= max) break;
      }
      if (!suggestions.length) throw new Error("AI 未返回有效标签");
      return suggestions;
    },
  };
}
