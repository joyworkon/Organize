/**
 * 主题集合（阶段 3）共享类型与纯函数。真实路由、mock shim、UI 三方共用。
 *
 * 语义（任务书 §三）：
 *   - 集合是引用容器：collection_items 只存来源坐标（092 三选一复合外键），
 *     标题/摘要在读取时实时 join，不复制正文或原件。
 *   - 来源状态三态：available=true 可用；false = 来源硬删已被 cascade、
 *     软删（回收站）或 RLS 不可达——前端显示「来源不可用」，绝不隐藏引用行。
 *   - 自动主题建议 = 确定性启发式（集合名与来源标题/标签的词元重合），
 *     只产生「建议」交用户确认，绝不自动写入手动分类。
 */
import type { ImportKind } from "@/lib/imports/types";

/** 集合可引用的三种来源（092 collection_items 三选一） */
export type CollectionSourceType = "reading" | "memo" | "file";

export interface CollectionSummary {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItemView {
  /** collection_items 行 id（移出集合用） */
  id: string;
  sourceType: CollectionSourceType;
  /** 来源表主键 */
  sourceId: string;
  title: string | null;
  excerpt: string | null;
  available: boolean;
  /** file 来源且已提取正文时的阅读条目（打开条目） */
  readingItemId: string | null;
  fileName: string | null;
  createdAt: string;
}

export interface CollectionDetail {
  collection: CollectionSummary;
  items: CollectionItemView[];
  nextCursor: string | null;
}

const STOP_CHARS = /[，。、！？：；（）“”‘’《》\s\d\p{P}\p{S}]/gu;

/** 标题/文本 → 词元（≥2 字的连续汉字段与英文小写词），供建议匹配 */
export function tokenizeForSuggest(text: string): string[] {
  return (text ?? "")
    .replace(STOP_CHARS, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * 自动主题建议（确定性启发式，用户确认制）：
 * 集合名与来源标题（或速记 #标签）的词元重合数 > 0 → 按重合度排序的建议候选。
 * 绝不写入，只返回 id 列表供 UI 展示「建议集合」芯片。
 */
export function suggestCollections(
  collections: Array<{ id: string; name: string }>,
  sourceHints: { title?: string | null; tags?: string[] },
  limit = 3,
): string[] {
  const sourceTokens = [
    ...new Set([
      ...tokenizeForSuggest(sourceHints.title ?? ""),
      ...(sourceHints.tags ?? []).map((t) => t.toLowerCase()),
    ]),
  ];
  if (sourceTokens.length === 0) return [];
  const matches = (nameToken: string): boolean =>
    sourceTokens.some(
      (t) => t === nameToken || (t.length >= 2 && nameToken.length >= 2 && (t.includes(nameToken) || nameToken.includes(t))),
    );
  return collections
    .map((c) => {
      const score = tokenizeForSuggest(c.name).filter(matches).length;
      return { id: c.id, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.id);
}

export function isCollectionSourceType(value: unknown): value is CollectionSourceType {
  return value === "reading" || value === "memo" || value === "file";
}

export const COLLECTION_NAME_MAX = 80;

export function validateCollectionName(name: unknown): string | null {
  if (typeof name !== "string") return "集合名无效";
  const trimmed = name.trim();
  if (!trimmed) return "集合名不能为空";
  if (trimmed.length > COLLECTION_NAME_MAX) return `集合名不能超过 ${COLLECTION_NAME_MAX} 字`;
  return null;
}

/** file 来源的 kind 展示名（与 FilesView 同款，避免 UI 双份漂移） */
export const COLLECTION_FILE_KIND_LABEL: Record<string, string> = {
  text: "文本", markdown: "Markdown", csv: "CSV", json: "JSON",
  pdf: "PDF", docx: "DOCX", xlsx: "XLSX", image: "图片", audio: "音频",
};

export type { ImportKind };
