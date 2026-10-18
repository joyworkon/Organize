// 速记「转为笔记」关联状态（memo_notes join notes 含软删）的构造与读取归一：
// memo_notes / notes 任一查询失败时保留上次结果并让调用方置错，不把失败伪装成
// 「没有关联」（那会让已转换速记显示成未转换、已删笔记显示成可点的「打开笔记」）。

/** 单条速记的关联笔记状态：noteDeleted = 关联笔记已移入垃圾箱（软删） */
export interface MemoConversion {
  noteId: string;
  noteTitle: string | null;
  noteDeleted: boolean;
}

/** 读取失败提示文案：列表上方展示（保留上次关联状态时的口径说明） */
export const MEMO_CONVERSIONS_ERROR_HINT = "笔记关联状态读取失败，显示可能不准确";

/**
 * 由 memo_notes 关联行 + notes 行构造 memo_id → 关联状态映射。
 * 与组件原构造逻辑一致：找不到对应 note（如查询被裁剪）时 noteTitle: null、noteDeleted: false。
 */
export function buildMemoConversions(
  links: Array<{ memo_id: string; note_id: string }>,
  notes: Array<{ id: string; title: string | null; deleted_at: string | null }>
): Map<string, MemoConversion> {
  const notesById = new Map<string, { title: string | null; deleted_at: string | null }>();
  for (const n of notes) {
    notesById.set(n.id, { title: n.title, deleted_at: n.deleted_at });
  }
  const conversions = new Map<string, MemoConversion>();
  for (const link of links) {
    const note = notesById.get(link.note_id);
    conversions.set(link.memo_id, {
      noteId: link.note_id,
      noteTitle: note?.title ?? null,
      noteDeleted: note?.deleted_at != null,
    });
  }
  return conversions;
}

export interface MemoConversionsLoadInput {
  /** memo_notes 查询结果与错误（error 为 null / undefined 均视为无错误） */
  links?: Array<{ memo_id: string; note_id: string }> | null;
  linksError?: unknown;
  /** notes 查询结果与错误（links 无关联时可缺省） */
  notes?: Array<{ id: string; title: string | null; deleted_at: string | null }> | null;
  notesError?: unknown;
  /** 上次成功结果：失败时原样返回，避免清空已有关联状态 */
  previous?: Map<string, MemoConversion>;
}

export type MemoConversionsLoadResult =
  | { ok: true; conversions: Map<string, MemoConversion> }
  | { ok: false; conversions: Map<string, MemoConversion> };

/**
 * 归一一次关联状态加载：任一查询失败 → ok: false 且返回 previous（保留上次结果）；
 * 全部成功 → ok: true 且按当前数据重建（links / notes 为 null 视同空）。
 */
export function resolveMemoConversionsLoad(input: MemoConversionsLoadInput): MemoConversionsLoadResult {
  if (input.linksError || input.notesError) {
    return { ok: false, conversions: input.previous ?? new Map() };
  }
  return {
    ok: true,
    conversions: buildMemoConversions(input.links ?? [], input.notes ?? []),
  };
}
