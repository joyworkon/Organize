import { definePlugin } from "@organize/plugin-sdk";
import type { ScrapeResult } from "@organize/shared";

const aiSummaryPlugin = definePlugin({
  id: "ai-summary",
  name: "AI 摘要",
  version: "0.1.0",
  description: "使用 AI 自动生成文章摘要，支持自定义摘要长度和风格",
  author: "Organize Team",
  icon: "🤖",
  configFields: [
    {
      key: "apiEndpoint",
      label: "AI API 地址",
      type: "text",
      placeholder: "https://api.openai.com/v1/chat/completions",
      required: true,
    },
    {
      key: "apiKey",
      label: "API Key",
      type: "text",
      placeholder: "sk-...",
      required: true,
    },
    {
      key: "maxLength",
      label: "摘要最大字数",
      type: "number",
      default: 200,
    },
    {
      key: "language",
      label: "摘要语言",
      type: "select",
      default: "zh",
      options: [
        { label: "中文", value: "zh" },
        { label: "English", value: "en" },
        { label: "跟随原文", value: "auto" },
      ],
    },
  ],
  extensions: [
    {
      type: "content-processor",
      id: "ai-summary-processor",
      label: "AI 摘要生成",
      handler: async (result: ScrapeResult, ctx) => {
        const config = ctx.getConfig<{
          apiEndpoint?: string;
          apiKey?: string;
          maxLength?: number;
          language?: string;
        }>();

        if (!config.apiEndpoint || !config.apiKey) {
          ctx.notify("请先配置 AI API 地址和密钥", "error");
          return result;
        }

        if (!result.content) {
          return result;
        }

        try {
          const lang = config.language === "auto" ? "" : `请用${config.language === "en" ? "英文" : "中文"}回复。`;
          const response = await fetch(config.apiEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-3.5-turbo",
              messages: [
                {
                  role: "system",
                  content: `你是一个文章摘要助手。请为以下文章生成不超过${config.maxLength || 200}字的精炼摘要。${lang}`,
                },
                {
                  role: "user",
                  content: result.content.replace(/<[^>]*>/g, "").slice(0, 8000),
                },
              ],
              max_tokens: 500,
            }),
          });

          if (!response.ok) throw new Error("API 请求失败");

          const data = await response.json();
          const summary = data.choices?.[0]?.message?.content;

          if (summary) {
            ctx.notify("AI 摘要生成成功", "success");
            return { ...result, excerpt: summary };
          }
        } catch (error) {
          ctx.notify("AI 摘要生成失败", "error");
        }

        return result;
      },
    },
    {
      type: "ai-action",
      id: "ai-summarize-text",
      label: "AI 总结选中文本",
      icon: "✨",
      handler: async (text: string, ctx) => {
        const config = ctx.getConfig<{
          apiEndpoint?: string;
          apiKey?: string;
        }>();

        if (!config.apiEndpoint || !config.apiKey) {
          ctx.notify("请先配置 AI API", "error");
          return text;
        }

        try {
          const response = await fetch(config.apiEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-3.5-turbo",
              messages: [
                { role: "system", content: "请总结以下文本的核心要点，用简洁的中文回复。" },
                { role: "user", content: text.slice(0, 4000) },
              ],
              max_tokens: 300,
            }),
          });

          const data = await response.json();
          return data.choices?.[0]?.message?.content || text;
        } catch {
          ctx.notify("AI 总结失败", "error");
          return text;
        }
      },
    },
  ],
});

export default aiSummaryPlugin;
