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
        const config = ctx.getConfig<{ maxLength?: number; language?: string }>();

        if (!result.content) {
          return result;
        }

        try {
          const lang = config.language === "auto" ? "" : `请用${config.language === "en" ? "英文" : "中文"}回复。`;
          const response = await fetch("/api/ai/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instruction: `生成不超过${config.maxLength || 200}字的精炼摘要。${lang}`,
              text: result.content.replace(/<[^>]*>/g, "").slice(0, 8000),
            }),
          });

          if (!response.ok) throw new Error("API 请求失败");

          const data = await response.json();
          const summary = data.text;

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
      supports: ["reading", "note-block"],
      handler: async (text: string, ctx) => {
        try {
          const response = await fetch("/api/ai/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instruction: "总结核心要点，用简洁的中文回复。",
              text: text.slice(0, 4000),
            }),
          });

          const data = await response.json();
          return data.text || text;
        } catch {
          ctx.notify("AI 总结失败", "error");
          return text;
        }
      },
    },
  ],
});

export default aiSummaryPlugin;
