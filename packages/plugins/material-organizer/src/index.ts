import { definePlugin } from "@organize/plugin-sdk";

export default definePlugin({
  id: "material-organizer",
  name: "智能物料整理",
  version: "0.1.0",
  description: "把图片、文本和录音拖到稍后读：提取文字、恢复排版，按内容整理并自动添加主题标签，保存为未读条目。使用设置中接入的大模型，图片需模型支持视觉识别。",
  icon: "🗂️",
  author: "Organize",
  extensions: [{
    type: "material-processor",
    id: "organize-materials",
    label: "识别与整理物料",
    async handler(request, ctx) {
      if (!ctx.data?.organizeMaterials) throw new Error("当前宿主不支持物料整理");
      return ctx.data.organizeMaterials(request);
    },
  }],
});
