/**
 * 笔记页内查找 / 替换的纯函数。
 *
 * 查找粒度与 note-search 一致：textblock 各列一次；列表项、任务项、单元格
 * 的 pos 归到视觉父节点。textPos 始终指向含命中文本的 textblock，替换只用它。
 * 替换只改该 textblock 内的文本区间，不删块、不改 type、不改 block id。
 */

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface SearchHit {
  /** 滚动与高亮用的位置。列表项 / 单元格时是视觉父节点，否则等于 textPos。 */
  pos: number;
  /** 含命中文本的 textblock 位置。替换必须用这个，不能用归并后的 pos。 */
  textPos: number;
  /** 块类型名（归并后可能是 listItem / tableCell 等） */
  type: string;
  /** 块 id（存在时；归并到父节点时读父节点 id） */
  id: string | null;
  /** 命中片段：前文 + 命中词 + 后文 */
  snippet: { before: string; match: string; after: string };
}

/** 每块只取首个命中，片段上下文各取约 24 个字符 */
export function buildSnippet(
  text: string,
  matchIndex: number,
  queryLength: number,
  radius = 24
): { before: string; match: string; after: string } {
  const before = text.slice(Math.max(0, matchIndex - radius), matchIndex);
  const match = text.slice(matchIndex, matchIndex + queryLength);
  const after = text.slice(matchIndex + queryLength, matchIndex + queryLength + radius);
  return { before, match, after };
}

/** 命中归属到这些父节点：跳转与高亮作用于整行 / 单元格，而不是其中的段落 */
const ATTRIBUTED_PARENTS = new Set(["listItem", "taskItem", "tableCell", "tableHeader"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 大小写不敏感的字面量首匹配。query 先 trim；空白查询没有匹配。 */
function findFirstMatch(text: string, query: string): { index: number; length: number } | null {
  const q = query.trim();
  if (!q) return null;
  const match = new RegExp(escapeRegExp(q), "i").exec(text);
  if (!match) return null;
  return { index: match.index, length: match[0].length };
}

/** 在文档中按 textblock 粒度搜索；query 为空返回空数组 */
export function searchTextBlocks(
  doc: ProseMirrorNode,
  query: string,
  limit = 100
): SearchHit[] {
  if (!query.trim()) return [];
  const hits: SearchHit[] = [];
  doc.descendants((node, pos) => {
    if (hits.length >= limit) return false;
    // 只匹配 textblock：容器块的文本由其内部 textblock 单独命中，避免重复
    if (!node.isTextblock) return true;
    const text = node.textContent;
    if (!text) return true;
    const found = findFirstMatch(text, query);
    if (!found) return true;

    let type = node.type.name;
    let id = typeof node.attrs?.id === "string" ? node.attrs.id : null;
    let hitPos = pos;
    const textPos = pos;
    // 列表项 / 任务项 / 单元格内的段落：归属到父节点，跳转高亮整个视觉单元
    try {
      const $pos = doc.resolve(pos);
      const parent = $pos.node($pos.depth);
      if (ATTRIBUTED_PARENTS.has(parent.type.name)) {
        type = parent.type.name;
        hitPos = $pos.before($pos.depth);
        id = typeof parent.attrs?.id === "string" ? parent.attrs.id : null;
      }
    } catch {
      // resolve 失败时退回段落自身定位
    }
    hits.push({
      pos: hitPos,
      textPos,
      type,
      id,
      snippet: buildSnippet(text, found.index, found.length),
    });
    return true;
  });
  return hits;
}

/**
 * 大小写不敏感替换首个匹配。replacement 原样写入，不跟着原词改大小写。
 * 空 query（或纯空白）不改文本。
 */
export function replaceFirstInText(
  text: string,
  query: string,
  replacement: string
): { next: string; did: boolean } {
  const found = findFirstMatch(text, query);
  if (!found) return { next: text, did: false };
  return {
    next: text.slice(0, found.index) + replacement + text.slice(found.index + found.length),
    did: true,
  };
}

function nodeAt(doc: ProseMirrorNode, pos: number): { pos: number; node: ProseMirrorNode } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const node = doc.nodeAt(pos);
  if (!node) return null;
  return { pos, node };
}

function resolveTextblock(
  doc: ProseMirrorNode,
  hit: SearchHit,
  query: string
): { pos: number; node: ProseMirrorNode } | null {
  const direct = nodeAt(doc, hit.textPos);
  if (direct?.node.isTextblock && findFirstMatch(direct.node.textContent, query)) return direct;
  const host = nodeAt(doc, hit.pos);
  if (!host) return null;
  if (host.node.isTextblock && findFirstMatch(host.node.textContent, query)) return host;
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  host.node.descendants((child, rel) => {
    if (found) return false;
    if (!child.isTextblock) return true;
    if (!findFirstMatch(child.textContent, query)) return true;
    found = { pos: host.pos + 1 + rel, node: child };
    return false;
  });
  return found;
}

/** 把 textContent 上的字符区间映射成文档位置（含跨 text node）。 */
function matchRange(
  blockPos: number,
  block: ProseMirrorNode,
  query: string
): { from: number; to: number } | null {
  const found = findFirstMatch(block.textContent, query);
  if (!found) return null;
  const startChar = found.index;
  const endChar = found.index + found.length;
  let seen = 0;
  let from: number | null = null;
  let to: number | null = null;
  block.descendants((child, rel) => {
    if (!child.isText || !child.text) return;
    const abs = blockPos + 1 + rel;
    const start = seen;
    const end = seen + child.text.length;
    if (from == null && startChar >= start && startChar < end) {
      from = abs + (startChar - start);
    }
    if (to == null && endChar > start && endChar <= end) {
      to = abs + (endChar - start);
    }
    seen = end;
    if (from != null && to != null) return false;
  });
  if (from == null || to == null || from >= to) return null;
  return { from, to };
}

/** 匹配起点若正好落在文本节点边界，marks() 会拿到前一个节点的标记；这里要的是被替换文本自己的标记。 */
function marksForReplacement(doc: ProseMirrorNode, from: number) {
  const $from = doc.resolve(from);
  const parent = $from.parent;
  const source = $from.textOffset
    ? parent.child($from.index()).marks
    : ($from.nodeAfter?.isText ? $from.nodeAfter.marks : $from.marks());
  return source.filter((mark) => parent.type.allowsMarkType(mark.type));
}

function writeReplacement(
  doc: ProseMirrorNode,
  tr: { delete: (from: number, to: number) => void; replaceWith: (from: number, to: number, content: ProseMirrorNode) => void },
  from: number,
  to: number,
  replacement: string
) {
  if (replacement.length === 0) {
    tr.delete(from, to);
    return;
  }
  tr.replaceWith(from, to, doc.type.schema.text(replacement, marksForReplacement(doc, from)));
}

function canEdit(editor: Editor): boolean {
  return !editor.isDestroyed && editor.isEditable;
}

/** 替换当前命中所在 textblock 的首个匹配。失败（只读、对不上、事务失败）返回 false。 */
export function applyReplaceAtHit(
  editor: Editor,
  hit: SearchHit,
  query: string,
  replacement: string
): boolean {
  if (!query.trim() || !canEdit(editor)) return false;
  const located = resolveTextblock(editor.state.doc, hit, query);
  if (!located) return false;
  const range = matchRange(located.pos, located.node, query);
  if (!range) return false;
  const tr = editor.state.tr;
  try {
    writeReplacement(tr.doc, tr, range.from, range.to, replacement);
  } catch {
    return false;
  }
  if (!tr.steps.length) return false;
  editor.view.dispatch(tr);
  return true;
}

/**
 * 按文档顺序，对每个命中 textblock 替换首个匹配（与 searchTextBlocks 每块一次一致）。
 * 从文档末尾往前写入同一事务，避免前面的替换撑开后面的位置。返回实际替换次数。
 */
export function applyReplaceAll(editor: Editor, query: string, replacement: string): number {
  if (!query.trim() || !canEdit(editor)) return 0;
  const hits = searchTextBlocks(editor.state.doc, query);
  const ranges: { from: number; to: number }[] = [];
  const seenBlocks = new Set<number>();
  for (const hit of hits) {
    const located = resolveTextblock(editor.state.doc, hit, query);
    if (!located || seenBlocks.has(located.pos)) continue;
    const range = matchRange(located.pos, located.node, query);
    if (!range) continue;
    seenBlocks.add(located.pos);
    ranges.push(range);
  }
  if (!ranges.length) return 0;
  ranges.sort((a, b) => b.from - a.from);
  const tr = editor.state.tr;
  try {
    for (const range of ranges) {
      writeReplacement(tr.doc, tr, range.from, range.to, replacement);
    }
  } catch {
    return 0;
  }
  if (!tr.steps.length) return 0;
  editor.view.dispatch(tr);
  return ranges.length;
}
