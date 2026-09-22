/**
 * 长文本 → 物料的确定性转换（阶段 C 资料库统一输入框的「不截断」路径）。
 *
 * 纯规则切块，不调用任何 AI：按空行分段，markdown 风格 `#`/`##` 标题、
 * `-`/`*` 无序列表、有序列表行归为对应块；超长段落按物料 schema 的
 * 单块上限（12000 字符）再切。产出经 validateMaterialResult 白名单校验。
 *
 * 既定限制：物料文本上限 4 万字符（lib/materials/schema.ts），超过时
 * 明确报错提示分段保存，绝不静默截断。
 */
import type { MaterialBlock, MaterialResult } from "@organize/plugin-sdk";
import { MAX_MATERIAL_TEXT, validateMaterialResult } from "./schema";

const BLOCK_TEXT_LIMIT = 12_000;
const MAX_BLOCKS = 200;

function splitLongText(text: string): string[] {
  if (text.length <= BLOCK_TEXT_LIMIT) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += BLOCK_TEXT_LIMIT) {
    chunks.push(text.slice(i, i + BLOCK_TEXT_LIMIT));
  }
  return chunks;
}

function isUnorderedListLine(line: string): boolean {
  return /^[-*•]\s+/.test(line);
}

function isOrderedListLine(line: string): boolean {
  return /^\d+[.、)]\s+/.test(line);
}

/** 标题候选：首个非空行（剥 markdown 标题符），截到物料标题上限内 */
function pickTitle(lines: string[]): string {
  for (const line of lines) {
    const cleaned = line.replace(/^#{1,6}\s*/, "").trim();
    if (cleaned) return cleaned.slice(0, 120);
  }
  return "粘贴的长文本";
}

export function textToMaterialResult(text: string): MaterialResult {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("内容为空");
  if (trimmed.length > MAX_MATERIAL_TEXT) {
    throw new Error(`文字不能超过 4 万字符（当前 ${trimmed.length}），请分段保存`);
  }

  const paragraphs = trimmed.split(/\r?\n\s*\r?\n/);
  const lines = paragraphs.flatMap((paragraph) => paragraph.split(/\r?\n/));
  const blocks: MaterialBlock[] = [];

  for (const paragraph of paragraphs) {
    const paragraphLines = paragraph.split(/\r?\n/).map((line) => line.trimEnd());
    const nonEmpty = paragraphLines.filter((line) => line.trim());
    if (!nonEmpty.length) continue;

    if (nonEmpty.every(isUnorderedListLine)) {
      blocks.push({
        type: "bulletList",
        items: nonEmpty.map((line) => line.replace(/^[-*•]\s+/, "").trim()),
      });
      continue;
    }
    if (nonEmpty.every(isOrderedListLine)) {
      blocks.push({
        type: "orderedList",
        items: nonEmpty.map((line) => line.replace(/^\d+[.、)]\s+/, "").trim()),
      });
      continue;
    }

    const headingMatch = paragraphLines[0].match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch && headingMatch[2].trim()) {
      const headingChunks = splitLongText(headingMatch[2].trim());
      blocks.push({ type: "heading", text: headingChunks[0] });
      for (const rest of headingChunks.slice(1)) {
        blocks.push({ type: "paragraph", text: rest });
      }
      for (const rest of paragraphLines.slice(1)) {
        if (rest.trim()) {
          for (const chunk of splitLongText(rest.trim())) {
            blocks.push({ type: "paragraph", text: chunk });
          }
        }
      }
      continue;
    }

    for (const line of paragraphLines) {
      if (!line.trim()) continue;
      for (const chunk of splitLongText(line.trim())) {
        blocks.push({ type: "paragraph", text: chunk });
      }
    }
  }

  if (!blocks.length) throw new Error("内容为空");
  if (blocks.length > MAX_BLOCKS) {
    throw new Error(`段落过多（超过 ${MAX_BLOCKS} 块），请分段保存`);
  }

  return validateMaterialResult({
    title: pickTitle(lines),
    category: "长文本",
    tags: [],
    blocks,
  });
}
