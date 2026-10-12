/**
 * 「按内容自动分组」：生成分组建议（不直接落库，用户在预览里确认后才写入）。
 *
 * 两条路径产出同一种结构 GroupProposal[]：
 *   - AI（设置里配置了 AI 服务时）：/api/notes/auto-group 让模型按主题归类，服务端用
 *     sanitizeAiProposals 校验（只认传入的笔记 id、每篇只进一个组、组名截断）。
 *   - 本地兜底 proposeGroupsLocally：不联网、确定性——
 *       1) 同一标签下 ≥2 篇笔记 → 以标签名成组；
 *       2) 其余笔记按「关键词」聚：英文单词 + 中文二字词（滑窗二元组，去掉含虚词的组合），
 *          标题权重 ×3，TF-IDF 选出既常见又有区分度的词；每个词把还没分组、且标题含该词
 *          或正文出现 ≥2 次的笔记聚成一组；
 *       3) 组名把关键词在组内笔记里向左右扩展成最长的公共片段（如「阅读」→「阅读笔记」）。
 *     凑不成组的笔记保持未分组。
 */

export interface AutoGroupNote {
  id: string;
  title: string | null;
  /** 正文纯文本（notes.search_text），调用方可截断 */
  text: string;
  tags: string[];
}

export interface GroupProposal {
  key: string;
  name: string;
  noteIds: string[];
  /** 给用户看的依据：「标签」「关键词：xx」「AI」 */
  reason: string;
}

const MAX_GROUPS = 8;
const MIN_SIZE = 2;
const TITLE_WEIGHT = 3;
const TEXT_LIMIT = 2000;

/** 中文虚词 / 高频无义字：含这些字的二字组合不当作关键词 */
const CJK_STOP_CHARS = new Set(
  Array.from("的了是在和与及或而也就都很还又被把对给从向到于为以之其这那哪些个一不有我你他她它们吗呢吧啊着过地得个上下中来去说要会能可让将已并但所如果因为所以没无第段关于")
);
const LATIN_STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "you", "your", "not", "but", "have", "has",
  "can", "will", "into", "about", "what", "when", "how", "why", "its", "our", "out", "use", "using", "http", "https", "www", "com",
]);

const CJK = /[\u4e00-\u9fff]/;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/[a-z][a-z0-9+#.-]{1,30}/g)) {
    const word = match[0].replace(/[.-]+$/, "");
    if (word.length >= 2 && !LATIN_STOP.has(word)) tokens.push(word);
  }
  for (const run of text.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let i = 0; i + 1 < run.length; i += 1) {
      const a = run[i];
      const b = run[i + 1];
      if (CJK_STOP_CHARS.has(a) || CJK_STOP_CHARS.has(b)) continue;
      tokens.push(a + b);
    }
  }
  return tokens;
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}

/** 英文关键词用原文里最常见的写法（react → React） */
function originalCasing(term: string, texts: string[]): string {
  const counts = new Map<string, number>();
  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  for (const text of texts) for (const m of text.match(pattern) || []) counts.set(m, (counts.get(m) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? term;
}

/** 把关键词在组内文本里向两侧扩展成最长的公共片段（覆盖 ≥60% 成员、最长 8 字） */
export function expandGroupName(term: string, texts: string[]): string {
  if (!CJK.test(term)) return originalCasing(term, texts);
  const need = Math.max(MIN_SIZE, Math.ceil(texts.length * 0.6));
  const coverage = (s: string) => texts.filter((t) => t.includes(s)).length;
  let best = term;
  for (;;) {
    const candidates = new Map<string, number>();
    for (const text of texts) {
      let from = text.indexOf(best);
      const seen = new Set<string>();
      while (from !== -1) {
        const left = text[from - 1];
        const right = text[from + best.length];
        if (left && CJK.test(left) && !CJK_STOP_CHARS.has(left)) seen.add(left + best);
        if (right && CJK.test(right) && !CJK_STOP_CHARS.has(right)) seen.add(best + right);
        from = text.indexOf(best, from + 1);
      }
      for (const s of seen) candidates.set(s, (candidates.get(s) || 0) + 1);
    }
    const next = [...candidates.entries()]
      .filter(([s, n]) => n >= need && s.length <= 8 && coverage(s) >= need)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!next) return best;
    best = next[0];
  }
}

export function proposeGroupsLocally(
  notes: AutoGroupNote[],
  options: { maxGroups?: number; minSize?: number } = {}
): GroupProposal[] {
  const maxGroups = options.maxGroups ?? MAX_GROUPS;
  const minSize = options.minSize ?? MIN_SIZE;
  const proposals: GroupProposal[] = [];
  const assigned = new Set<string>();
  if (notes.length < minSize) return proposals;

  // 1) 标签：笔记多的标签优先；一篇笔记只进第一个命中的标签组
  const byTag = new Map<string, string[]>();
  for (const note of notes) {
    for (const tag of note.tags) {
      const name = tag.trim();
      if (!name) continue;
      byTag.set(name, [...(byTag.get(name) || []), note.id]);
    }
  }
  const tagOrder = [...byTag.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "zh-CN"));
  for (const [tag, ids] of tagOrder) {
    if (proposals.length >= maxGroups) break;
    const members = ids.filter((id) => !assigned.has(id));
    if (members.length < minSize) continue;
    members.forEach((id) => assigned.add(id));
    proposals.push({ key: `tag:${tag}`, name: tag, noteIds: members, reason: "标签" });
  }

  // 2) 关键词（TF-IDF）
  const docs = notes.map((note) => {
    const title = (note.title || "").trim();
    const text = (note.text || "").slice(0, TEXT_LIMIT);
    const titleTokens = countTokens(tokenize(title));
    const bodyTokens = countTokens(tokenize(text));
    const weighted = new Map(bodyTokens);
    for (const [t, n] of titleTokens) weighted.set(t, (weighted.get(t) || 0) + n * TITLE_WEIGHT);
    return { note, title, raw: `${title}\n${text}`, titleTokens, bodyTokens, weighted };
  });
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of doc.weighted.keys()) df.set(t, (df.get(t) || 0) + 1);
  const n = docs.length;
  const maxDf = n >= 5 ? Math.floor(n * 0.6) : n;
  const scored = [...df.entries()]
    .filter(([, d]) => d >= minSize && d <= maxDf)
    .map(([term, d]) => {
      const idf = Math.log(1 + n / d);
      let tf = 0;
      for (const doc of docs) tf += Math.min(doc.weighted.get(term) || 0, 6);
      return { term, score: tf * idf };
    })
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

  const usedNames = new Set(proposals.map((p) => p.name));
  for (const { term } of scored) {
    if (proposals.length >= maxGroups) break;
    const members = docs.filter(
      (doc) =>
        !assigned.has(doc.note.id) &&
        ((doc.titleTokens.get(term) || 0) > 0 || (doc.bodyTokens.get(term) || 0) >= 2)
    );
    if (members.length < minSize) continue;
    const name = expandGroupName(term, members.map((m) => m.raw));
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    members.forEach((m) => assigned.add(m.note.id));
    proposals.push({
      key: `kw:${name}`,
      name,
      noteIds: members.map((m) => m.note.id),
      reason: `关键词：${name}`,
    });
  }
  return proposals;
}

/** 校验并规整 AI 返回的分组：只认已知 id、每篇只进第一个组、去掉空组与过短组名 */
export function sanitizeAiProposals(raw: unknown, knownIds: Set<string>, maxGroups = MAX_GROUPS): GroupProposal[] {
  const list = Array.isArray((raw as { groups?: unknown })?.groups)
    ? ((raw as { groups: unknown[] }).groups)
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  const assigned = new Set<string>();
  const proposals: GroupProposal[] = [];
  for (const item of list) {
    if (proposals.length >= maxGroups) break;
    const name = typeof (item as { name?: unknown })?.name === "string" ? (item as { name: string }).name.trim().slice(0, 40) : "";
    const ids = Array.isArray((item as { noteIds?: unknown })?.noteIds) ? (item as { noteIds: unknown[] }).noteIds : [];
    const members = ids.filter((id): id is string => typeof id === "string" && knownIds.has(id) && !assigned.has(id));
    if (!name || members.length === 0) continue;
    members.forEach((id) => assigned.add(id));
    proposals.push({ key: `ai:${proposals.length}:${name}`, name, noteIds: members, reason: "AI" });
  }
  return proposals;
}

/** 从模型输出里取出 JSON（容忍 ```json 代码块包裹与前后说明文字） */
export function parseJsonFromModel(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("模型没有返回 JSON");
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  return JSON.parse(body.slice(start, end + 1));
}
