
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
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const MAX_ROWS = 5000;

/**
 * v1（074 get_note_backlinks）：OFFSET 分页 + content LIKE 全扫。
 * 语义保守（纯文本/外站同路径误报、锚点/编码漏报），仅作 v2 故障时的临时回退读路径
 * （B03-4 守门窗口；真实环境验证后由清理 PR 收编，勿新增调用方）。
 */
export async function fetchAllNoteBacklinksV1(
  supabase: BacklinkRpcClient,
  noteId: string,
  pageSize = 100
): Promise<NoteBacklinkRow[]> {
  const collected: NoteBacklinkRow[] = [];
  let total = Number.POSITIVE_INFINITY;
  let page = 0;
  const maxPages = Math.max(1, Math.ceil(MAX_ROWS / Math.max(pageSize, 1)));

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

/**
 * v2（078 get_note_backlinks_v2）：keyset 稳定游标 + 精确内链索引 + 授权共享来源可见。
 * 游标合同：响应**省略 next_cursor 键**（或为 JSON null）= 取尽；
 * `data.next_cursor` 缺失时得 undefined、JSON null 时得 null，两者均判停。
 */
export async function fetchAllNoteBacklinksV2(
  supabase: BacklinkRpcClient,
  noteId: string,
  pageSize = 100
): Promise<NoteBacklinkRow[]> {
  const collected: NoteBacklinkRow[] = [];
  let cursor: unknown = null;
  const maxPages = Math.max(1, Math.ceil(MAX_ROWS / Math.max(pageSize, 1)));

  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await supabase.rpc("get_note_backlinks_v2", {
      p_note_id: noteId,
      p_page_size: pageSize,
      p_cursor: cursor,
    });
    if (error) throw error;
    const result = data as { rows?: unknown; next_cursor?: unknown } | null;
    if (!result || !Array.isArray(result.rows)) break;
    collected.push(...(result.rows as NoteBacklinkRow[]));
    const next = result.next_cursor;
    if (next === undefined || next === null) break; // 键缺失 = 取尽（服务端合同）
    cursor = next;
  }
  return collected;
}

/**
 * R10b：反链读取入口——v2 优先（精确索引 + 稳定游标 + 共享来源可见），
 * v2 RPC 报错（发布竞态下函数未就绪 / 网络抖动等）自动回退 v1 并告警。
 * 行形状两代一致（{id,title,created_at}），UI 无感。
 */
export async function fetchAllNoteBacklinks(
  supabase: BacklinkRpcClient,
  noteId: string,
  pageSize = 100
): Promise<NoteBacklinkRow[]> {
  try {
    return await fetchAllNoteBacklinksV2(supabase, noteId, pageSize);
  } catch (v2Error) {
    console.warn("[backlinks] v2 读取失败，回退 v1（临时守门窗口）", v2Error);
    return fetchAllNoteBacklinksV1(supabase, noteId, pageSize);
  }
}
