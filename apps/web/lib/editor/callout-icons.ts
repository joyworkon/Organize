/**
 * 标注块（Callout）图标与语义色调的纯数据/纯函数层：
 * 内置关键词表驱动选择器搜索（中英文各若干，不引入 emoji 库），
 * normalize 两个属性入口（schema 默认值 / parseHTML / NodeView 共用），可独立单测。
 */

export interface CalloutIconOption {
  emoji: string;
  /** 搜索关键词（中英文，小写匹配） */
  keywords: string[];
}

export const CALLOUT_ICON_OPTIONS: readonly CalloutIconOption[] = [
  { emoji: "💡", keywords: ["idea", "light", "tip", "提示", "灵感", "想法", "灯泡"] },
  { emoji: "⚠️", keywords: ["warning", "caution", "warn", "警告", "注意", "小心"] },
  { emoji: "📌", keywords: ["pin", "pinned", "图钉", "置顶", "固定", "钉"] },
  { emoji: "✅", keywords: ["check", "done", "ok", "完成", "已办", "对", "勾"] },
  { emoji: "❌", keywords: ["cross", "wrong", "fail", "错误", "失败", "叉", "不对"] },
  { emoji: "🔥", keywords: ["fire", "hot", "火", "热门", "重要"] },
  { emoji: "💪", keywords: ["strong", "power", "力量", "加油", "肌肉"] },
  { emoji: "📖", keywords: ["book", "read", "书", "阅读", "书本"] },
  { emoji: "🎯", keywords: ["target", "goal", "目标", "目的", "靶"] },
  { emoji: "⭐", keywords: ["star", "favorite", "星", "收藏", "重点"] },
  { emoji: "🚀", keywords: ["rocket", "launch", "发布", "上线", "快速", "火箭"] },
  { emoji: "💯", keywords: ["perfect", "hundred", "满分", "百分", "完美"] },
  { emoji: "❗", keywords: ["important", "exclaim", "重要", "感叹", "惊叹"] },
  { emoji: "❓", keywords: ["question", "help", "问题", "疑问", "帮助", "提问"] },
  { emoji: "📝", keywords: ["note", "write", "edit", "笔记", "记录", "编辑", "备忘"] },
  { emoji: "🎉", keywords: ["party", "celebrate", "庆祝", "祝贺", "好棒"] },
  { emoji: "❤️", keywords: ["heart", "like", "love", "爱", "喜欢", "心", "点赞"] },
  { emoji: "👍", keywords: ["up", "like", "good", "赞", "好", "顶", "点赞"] },
  { emoji: "👎", keywords: ["down", "bad", "踩", "不好", "差"] },
  { emoji: "💬", keywords: ["comment", "talk", "chat", "评论", "对话", "消息", "留言"] },
  { emoji: "🤔", keywords: ["think", "consider", "考虑", "思考", "疑惑", "想想"] },
  { emoji: "😂", keywords: ["laugh", "funny", "笑", "搞笑", "哈哈", "开心"] },
  { emoji: "😭", keywords: ["cry", "sad", "哭", "难过", "伤心"] },
  { emoji: "😡", keywords: ["angry", "mad", "生气", "愤怒", "气"] },
];

/** 网格固定 6 列，手机保留至少 44px 点击区；方向键按同一列数换行。 */
export const CALLOUT_ICON_GRID_COLUMNS = 6;

export const CALLOUT_TONES = [
  { value: "default", label: "默认" },
  { value: "info", label: "信息" },
  { value: "success", label: "成功" },
  { value: "warning", label: "警告" },
  { value: "danger", label: "危险" },
] as const;

export type CalloutTone = (typeof CALLOUT_TONES)[number]["value"];

export const DEFAULT_CALLOUT_EMOJI = "💡";

export function normalizeCalloutTone(value: unknown): CalloutTone {
  const tone = typeof value === "string" ? value : "";
  return (CALLOUT_TONES.find((item) => item.value === tone)?.value ?? "default") as CalloutTone;
}

/** emoji 统一成单个字符串；空串 = 无图标（合法存储值，round-trip 保留） */
export function normalizeCalloutEmoji(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CALLOUT_EMOJI;
  const trimmed = value.trim();
  if (!trimmed) return "";
  // ZWJ 家庭等复合 emoji 可超过 8 个 UTF-16 码元，不能按长度丢弃旧文档图标。
  return trimmed;
}

export function filterCalloutIcons(query: string): readonly CalloutIconOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return CALLOUT_ICON_OPTIONS;
  return CALLOUT_ICON_OPTIONS.filter(
    (option) => option.emoji.includes(normalized) || option.keywords.some((keyword) => keyword.includes(normalized))
  );
}
