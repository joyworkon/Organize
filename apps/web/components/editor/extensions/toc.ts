import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const DEFAULT_TOC_LEVELS = [1, 2, 3];

export interface TocEntry {
  id: string;
  level: number;
  text: string;
  pos: number;
}

/**
 * 收集文档里的标题作为目录条目。
 * - 只收 heading（level ∈ levels）
 * - details 内 summary 是 detailsSummary 节点，本身不是 heading，天然被排除
 * - details 内嵌套的普通 heading 仍会被收录（它们是真实标题）
 */
export function collectTocEntries(
  doc: ProseMirrorNode,
  levels: number[] = DEFAULT_TOC_LEVELS
): TocEntry[] {
  const levelSet = new Set(levels);
  const entries: TocEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading" && levelSet.has(Number(node.attrs.level))) {
      entries.push({
        id: String(node.attrs.id || ""),
        level: Number(node.attrs.level),
        text: node.textContent || "无标题",
        pos,
      });
    }
    return true;
  });
  return entries;
}

/** 校验 levels 属性：必须是非空、1–6 范围内的整数数组，否则回退默认。 */
export function normalizeTocLevels(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_TOC_LEVELS;
  const filtered = value
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);
  return filtered.length ? Array.from(new Set(filtered)).sort((a, b) => a - b) : DEFAULT_TOC_LEVELS;
}

/** 把 levels 序列化为 data-levels 属性值。 */
export function serializeTocLevels(levels: number[]): string {
  return levels.join(",");
}

/** 解析 data-levels 属性字符串，失败回退默认。 */
export function parseTocLevels(raw: string | null): number[] {
  if (!raw) return DEFAULT_TOC_LEVELS;
  const parsed = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);
  return parsed.length ? Array.from(new Set(parsed)).sort((a, b) => a - b) : DEFAULT_TOC_LEVELS;
}
