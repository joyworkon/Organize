import { definePlugin } from "@organize/plugin-sdk";
import type { ScrapeResult } from "@organize/shared";

const aiSummaryPlugin = definePlugin({
  id: "ai-summary",
  name: "AI 摘要",
  version: "0.2.0",
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
  onActivate: (ctx) => {
    ctx.registerCommand?.({
      id: "summarize-current-item",
      title: "为当前阅读条目生成摘要",
      icon: "🤖",
      keywords: ["ai", "summary", "摘要", "总结"],
      handler: async (commandCtx) => {
        const item = commandCtx.getCurrentItem();
        if (!item) {
          commandCtx.notify("请先打开一篇阅读条目，再执行本命令", "info");
          return;
        }
        const text = (item.content || "").replace(/<[^>]*>/g, "").slice(0, 8000);
        if (!text) {
          commandCtx.notify("当前条目没有可总结的正文", "info");
          return;
        }
        const config = commandCtx.getConfig<{ maxLength?: number; language?: string }>();
        const lang =
          config.language === "auto"
            ? ""
            : `请用${config.language === "en" ? "英文" : "中文"}回复。`;
        if (!commandCtx.data) {
          commandCtx.notify("当前宿主不支持 AI 服务", "error");
          return;
        }
        try {
          const summary = await commandCtx.data.askAI({
            instruction: `生成不超过${config.maxLength || 200}字的精炼摘要。${lang}`,
            text,
          });
          commandCtx.notify(`AI 摘要：${summary}`, "success");
        } catch {
          commandCtx.notify("AI 摘要生成失败", "error");
        }
      },
    });
  },
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
        if (!ctx.data) {
          // 宿主未注入数据面（如测试环境）：静默跳过，不阻塞抓取入库
          return result;
        }

        try {
          const lang = config.language === "auto" ? "" : `请用${config.language === "en" ? "英文" : "中文"}回复。`;
          const summary = await ctx.data.askAI({
            instruction: `生成不超过${config.maxLength || 200}字的精炼摘要。${lang}`,
            text: result.content.replace(/<[^>]*>/g, "").slice(0, 8000),
          });

          if (summary) {
            ctx.notify("AI 摘要生成成功", "success");
            return { ...result, excerpt: summary };
          }
        } catch {
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
        if (!ctx.data) {
          ctx.notify("当前宿主不支持 AI 服务", "error");
          return text;
        }
        try {
          return await ctx.data.askAI({
            instruction: "总结核心要点，用简洁的中文回复。",
            text: text.slice(0, 4000),
          });
        } catch {
          ctx.notify("AI 总结失败", "error");
          return text;
        }
      },
    },
  ],
});

export default aiSummaryPlugin;
