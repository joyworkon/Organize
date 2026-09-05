
export interface NoteBacklinkRow {
  id: string;
  title: string | null;
  created_at: string;
}

export interface NoteBacklinkPage {
  total: number;
  rows: NoteBacklinkRow[];
}

/** 最小结构接口：便于测试注入 fake（与 supabase.rpc 调用形状兼容） */
export interface BacklinkRpcClient {
  rpc(
    fn: string,
    args: { p_note_id: string; p_page_size: number; p_page: number }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * R10a：按页取全「链接到 noteId 的来源笔记」（后端 get_note_backlinks RPC）。
 * - 完整性：不受旧实现的“最近 100 篇”截断；按页循环直到取满 total
 * - 权限：RPC 内 auth.uid() 过滤（只回调用者自己的笔记）；软删除来源不返回
 * - 防御：最多循环 ceil(5000/页大小) 页（5000 条上限），异常页形终止避免死循环
 */
export async function fetchAllNoteBacklinks(
  supabase: BacklinkRpcClient,
  noteId: string,
  pageSize = 100
): Promise<NoteBacklinkRow[]> {
  const collected: NoteBacklinkRow[] = [];
  let total = Number.POSITIVE_INFINITY;
  let page = 0;
  const maxPages = Math.max(1, Math.ceil(5000 / Math.max(pageSize, 1)));

  while (collected.length < total && page < maxPages) {
    const { data, error } = await supabase.rpc("get_note_backlinks", {
      p_note_id: noteId,
      p_page_size: pageSize,
      p_page: page,
    });
    if (error) throw error;
    const result = data as NoteBacklinkPage | null;
    if (!result || !Array.isArray(result.rows)) break;
    total = typeof result.total === "number" ? result.total : collected.length + result.rows.length;
    collected.push(...result.rows);
    if (result.rows.length === 0) break; // 空页防御：服务器已无更多行
    page += 1;
  }
  return collected;
}
