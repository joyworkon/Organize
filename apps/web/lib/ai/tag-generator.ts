/**
 * 标签生成器接口
 *
 * 设计：把"如何生成标签"和"何时生成标签"解耦。
 * - 默认实现：关键词提取（本地、零成本）
 * - 可选实现：调用 AI API（OpenAI / 通义 / Claude），通过环境变量切换
 *
 * 后续接入 AI 时，只需要：
 *   1. 在 .env.local 配置 OPENAI_API_KEY（或其它提供商）
 *   2. 本文件自动走 AI 分支
 *   不需要改其它代码。
 */

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

// ---------- AI 实现（预留接口，后续接入） ----------

/**
 * AI 标签生成器（占位实现）
 *
 * 接入步骤：
 * 1. pnpm add openai（或别的 SDK）
 * 2. 在 .env.local 配：
 *    OPENAI_API_KEY=sk-xxx
 *    AI_TAG_PROVIDER=openai   （可选，默认 keyword）
 * 3. 把下面的 generate 改成真正的 API 调用
 *
 * 这里保留骨架，不引入依赖，避免污染 bundle。
 */
export const aiTagGenerator: TagGenerator = {
  async generate(input) {
    // ───── 后续接入 OpenAI 的参考代码（注释掉，避免未装依赖报错）─────
    //
    // if (!process.env.OPENAI_API_KEY) {
    //   throw new Error("未配置 OPENAI_API_KEY");
    // }
    // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // const resp = await openai.chat.completions.create({
    //   model: "gpt-4o-mini",
    //   messages: [
    //     {
    //       role: "system",
    //       content:
    //         "根据用户提供的文章内容，推荐 3-5 个标签。要求简洁（2-6 字），" +
    //         "优先复用用户已有的标签。返回 JSON 数组：[{\"name\":\"标签名\",\"score\":0.9}]",
    //     },
    //     {
    //       role: "user",
    //       content: `标题：${input.title}\n已有标签：${input.existingTagNames.join(", ")}\n内容：${input.text.slice(0, 3000)}`,
    //     },
    //   ],
    //   temperature: 0.3,
    //   response_format: { type: "json_object" },
    // });
    // return JSON.parse(resp.choices[0].message.content || "[]").tags;
    //
    // ──────────────────────────────────────────────────────────────

    // 当前：未接入 AI，直接退化到关键词
    void input;
    throw new Error("AI 标签生成器未配置，请在 .env.local 设置 OPENAI_API_KEY 并实现 lib/ai/tag-generator.ts");
  },
};

/**
 * 根据环境变量选择生成器。
 * 后续接入 AI 时，只要在 .env.local 加：
 *   AI_TAG_PROVIDER=openai
 *   OPENAI_API_KEY=sk-xxx
 * 就自动切换，无需改业务代码。
 */
export function getTagGenerator(): TagGenerator {
  const provider = process.env.AI_TAG_PROVIDER || process.env.NEXT_PUBLIC_AI_TAG_PROVIDER;
  if (provider === "openai" || process.env.OPENAI_API_KEY) {
    return aiTagGenerator;
  }
  return keywordTagGenerator;
}
