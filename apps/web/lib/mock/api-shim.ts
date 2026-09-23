// mock 后端的浏览器端 fetch 拦截层：把笔记历史版本、块评论、块建议、跨笔记移动块
// 等 /api/* 调用路由到内存 mockDb 实现，让这些功能在无 Docker/Supabase 的
// 开发机（NEXT_PUBLIC_MOCK_BACKEND=true）上可用。
// 由 lib/supabase/client.ts 在 mock 模式下模块加载时同步安装（先于任何组件 effect）。
// 不在覆盖范围（保持直连、由调用方按失败降级）：AI（/api/ai/*）、上传（/api/upload）、
// 数据库块（/api/databases*）、未登录 cron 类接口。
import { mockDb, MOCK_USER } from "@/lib/supabase/mock-data";
import { parseMemoTags } from "@/lib/memos/tags";
import { createCollectionRoutes } from "@/lib/mock/api-shim-collections";
import { validateCanvasContent } from "@/lib/canvas/validation";
import { CANVAS_SCHEMA_VERSION, ensureCanvasDocV2 } from "@/lib/canvas/model";
import { decodeLibraryCursor, encodeLibraryCursor } from "@/lib/library/cursor";

type MockHandlerResult = { status?: number; body: unknown; headers?: Record<string, string> };
type MockHandler = (ctx: {
  body: any;
  params: Record<string, string>;
  url: URL;
  /** 原始请求体（multipart 等非 JSON 体由此自取；JSON 已解析进 body） */
  rawBody?: BodyInit | null;
}) => MockHandlerResult | Promise<MockHandlerResult>;

interface MockRoute {
  method: string;
  pattern: RegExp;
  handler: MockHandler;
}

const genId = (table: string) => `${table}-${Math.random().toString(36).slice(2, 10)}`;
const nowIso = () => new Date().toISOString();

function findNote(noteId: string) {
  return mockDb.notes.find((row) => row.id === noteId && row.user_id === MOCK_USER.id);
}

// ---- 历史版本 ----

const listVersions: MockHandler = ({ params }) => {
  if (!findNote(params.id)) return { status: 404, body: { error: "笔记不存在" } };
  const rows = mockDb.note_versions
    .filter((v) => v.note_id === params.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 50)
    .map((v) => ({ id: v.id, title: v.title, message: v.message, created_at: v.created_at }));
  return { body: rows };
};

const getVersion: MockHandler = ({ params }) => {
  const version = mockDb.note_versions.find(
    (v) => v.id === params.versionId && v.note_id === params.id
  );
  if (!version) return { status: 404, body: { error: "版本不存在" } };
  return {
    body: {
      id: version.id,
      note_id: version.note_id,
      content: version.content,
      title: version.title,
      created_at: version.created_at,
    },
  };
};

// 对齐真实 restore_note_version RPC 的可观察行为：恢复内容/标题、递增 content_revision、
// 恢复前把当前内容存为一条自动备份版本
const restoreVersion: MockHandler = ({ params }) => {
  const note = findNote(params.id);
  if (!note) return { status: 404, body: { error: "笔记不存在" } };
  const version = mockDb.note_versions.find(
    (v) => v.id === params.versionId && v.note_id === params.id
  );
  if (!version) return { status: 404, body: { error: "版本不存在" } };

  mockDb.note_versions.push({
    id: genId("note_versions"),
    note_id: note.id,
    title: note.title ?? null,
    message: "恢复前自动备份",
    content: note.content ?? null,
    created_at: nowIso(),
  });
  note.content = version.content ?? null;
  note.title = version.title ?? null;
  const noteRevision = (note.content_revision ?? 0) + 1;
  note.content_revision = noteRevision;
  note.updated_at = nowIso();
  return { body: { success: true, noteRevision } };
};

const deleteVersion: MockHandler = ({ params }) => {
  if (!findNote(params.id)) return { status: 404, body: { error: "笔记不存在" } };
  mockDb.note_versions = mockDb.note_versions.filter(
    (v) => !(v.id === params.versionId && v.note_id === params.id)
  );
  return { body: { success: true } };
};

// ---- 块评论（线程嵌套评论）----

const threadWithComments = (thread: any) => ({
  ...thread,
  comments: mockDb.note_comments
    .filter((c) => c.thread_id === thread.id)
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1)),
});

const listCommentThreads: MockHandler = ({ params, url }) => {
  if (!findNote(params.id)) return { status: 404, body: { error: "笔记不存在" } };
  const blockId = url.searchParams.get("blockId");
  const rows = mockDb.note_comment_threads
    .filter((t) => t.note_id === params.id && (!blockId || t.block_id === blockId))
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1))
    .map(threadWithComments);
  return { body: rows };
};

const createComment: MockHandler = ({ body, params }) => {
  const blockId = body?.blockId;
  // 与真实路由一致：评论文本字段是 body.body
  const text = String(body?.body || "").trim();
  if (!blockId || !text || text.length > 5000) {
    return { status: 400, body: { error: "评论内容无效" } };
  }
  if (body.threadId) {
    const thread = mockDb.note_comment_threads.find(
      (t) => t.id === body.threadId && t.note_id === params.id
    );
    if (!thread) return { status: 404, body: { error: "评论线程不存在" } };
    const comment = {
      id: genId("note_comments"),
      thread_id: thread.id,
      user_id: MOCK_USER.id,
      body: text,
      created_at: nowIso(),
    };
    mockDb.note_comments.push(comment);
    return { status: 201, body: comment };
  }
  const thread = {
    id: genId("note_comment_threads"),
    note_id: params.id,
    block_id: blockId,
    user_id: MOCK_USER.id,
    resolved_at: null,
    created_at: nowIso(),
  };
  mockDb.note_comment_threads.push(thread);
  mockDb.note_comments.push({
    id: genId("note_comments"),
    thread_id: thread.id,
    user_id: MOCK_USER.id,
    body: text,
    created_at: nowIso(),
  });
  return { status: 201, body: threadWithComments(thread) };
};

const patchComment: MockHandler = ({ body, params }) => {
  if (body?.commentId && typeof body.body === "string") {
    const text = body.body.trim();
    if (!text || text.length > 5000) return { status: 400, body: { error: "评论内容无效" } };
    const comment = mockDb.note_comments.find((c) => c.id === body.commentId);
    if (!comment) return { status: 500, body: { error: "评论不存在" } };
    comment.body = text;
    return { body: comment };
  }
  if (body?.threadId && typeof body.resolved === "boolean") {
    const thread = mockDb.note_comment_threads.find(
      (t) => t.id === body.threadId && t.note_id === params.id
    );
    if (!thread) return { status: 500, body: { error: "线程不存在" } };
    thread.resolved_at = body.resolved ? nowIso() : null;
    return { body: threadWithComments(thread) };
  }
  return { status: 400, body: { error: "无效操作" } };
};

const deleteComment: MockHandler = ({ body, params }) => {
  if (body?.commentId) {
    mockDb.note_comments = mockDb.note_comments.filter((c) => c.id !== body.commentId);
  } else if (body?.threadId) {
    mockDb.note_comment_threads = mockDb.note_comment_threads.filter(
      (t) => !(t.id === body.threadId && t.note_id === params.id)
    );
    mockDb.note_comments = mockDb.note_comments.filter((c) => c.thread_id !== body.threadId);
  } else {
    return { status: 400, body: { error: "无效操作" } };
  }
  return { body: { success: true } };
};

// ---- 块建议（pending → accepted/rejected）----

const listSuggestions: MockHandler = ({ params, url }) => {
  if (!findNote(params.id)) return { status: 404, body: { error: "笔记不存在" } };
  const blockId = url.searchParams.get("blockId");
  const rows = mockDb.note_suggestions
    .filter((s) => s.note_id === params.id && (!blockId || s.block_id === blockId))
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
  return { body: rows };
};

const createSuggestion: MockHandler = ({ body, params }) => {
  if (!body?.blockId || !body?.originalBlock || !body?.proposedBlock) {
    return { status: 400, body: { error: "建议内容不完整" } };
  }
  const row = {
    id: genId("note_suggestions"),
    note_id: params.id,
    block_id: body.blockId,
    user_id: MOCK_USER.id,
    original_block: body.originalBlock,
    proposed_block: body.proposedBlock,
    status: "pending",
    created_at: nowIso(),
  };
  mockDb.note_suggestions.push(row);
  return { status: 201, body: row };
};

const patchSuggestion: MockHandler = ({ body, params }) => {
  if (!body?.suggestionId || !["accepted", "rejected"].includes(body.status)) {
    return { status: 400, body: { error: "无效状态" } };
  }
  const row = mockDb.note_suggestions.find(
    (s) =>
      s.id === body.suggestionId &&
      s.note_id === params.id &&
      s.status === "pending"
  );
  if (!row) return { status: 409, body: { error: "建议不存在或已处理" } };
  row.status = body.status;
  return { body: row };
};

// ---- 跨笔记移动块（对齐 move_note_block RPC）----

const moveBlock: MockHandler = ({ body, params }) => {
  const targetNoteId = String(body?.targetNoteId || "");
  const blockId = String(body?.blockId || "");
  if (!targetNoteId || !blockId || targetNoteId === params.id) {
    return { status: 400, body: { error: "移动目标无效" } };
  }
  const source = findNote(params.id);
  const target = findNote(targetNoteId);
  if (!source || !target) {
    return { status: 409, body: { error: "Note not found or access denied" } };
  }

  const sourceBlocks: any[] = source.content?.content ?? [];
  const index = sourceBlocks.findIndex(
    (block) => block?.attrs?.id === blockId
  );
  if (index === -1) return { status: 409, body: { error: "Block not found" } };

  const movingBlock = sourceBlocks[index];
  const remaining = sourceBlocks.filter((_, i) => i !== index);
  // 源笔记搬空后补一个空段落占位（与 RPC 一致）
  source.content = {
    ...source.content,
    content: remaining.length > 0 ? remaining : [{ type: "paragraph" }],
  };
  target.content = {
    ...target.content,
    content: [...(target.content?.content ?? []), movingBlock],
  };
  source.updated_at = nowIso();
  target.updated_at = nowIso();

  // 批注与建议跟随区块迁移，避免在源笔记留下不可见的孤儿锚点
  for (const thread of mockDb.note_comment_threads) {
    if (thread.note_id === params.id && thread.block_id === blockId) {
      thread.note_id = targetNoteId;
    }
  }
  for (const suggestion of mockDb.note_suggestions) {
    if (suggestion.note_id === params.id && suggestion.block_id === blockId) {
      suggestion.note_id = targetNoteId;
    }
  }
  return { body: { success: true } };
};

// ---- 速记 memos ----

const listMemos: MockHandler = ({ url }) => {
  const tag = url.searchParams.get("tag");
  // 与真实路由一致：?limit= 截断（1–500），非法值回落全量
  const limitParam = Number(url.searchParams.get("limit"));
  const limit =
    Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 500) : 500;
  // F04：稳定排序（created_at 倒序 + id 倒序）+ ?before= 游标；X-Total-Count 全量计数
  const before = url.searchParams.get("before");
  const all = mockDb.memos
    .filter((m) => !m.deleted_at && (!tag || (m.tags as string[]).includes(tag)))
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
  const filtered = before
    ? all.filter((m) => m.created_at < before)
    : all;
  const rows = filtered.slice(0, limit);
  return {
    status: 200,
    body: rows,
    headers: { "X-Total-Count": String(all.length), "Content-Type": "application/json" },
  };
};

// F04：标签聚合（mock 与真实路由一致，基于全量未删速记）
const listMemoTags: MockHandler = () => {
  const counts = new Map<string, number>();
  for (const m of mockDb.memos) {
    if (m.deleted_at) continue;
    for (const tag of m.tags as string[]) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return {
    body: Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
};

// F05：按 id 补取单条（深链定位）
const getMemo: MockHandler = ({ params }) => {
  const row = mockDb.memos.find((m) => m.id === params.id && !m.deleted_at);
  if (!row) return { status: 404, body: { error: "速记不存在或已删除" } };
  return { body: row };
};

const createMemo: MockHandler = ({ body }) => {
  const content = String(body?.content || "").trim();
  if (!content || content.length > 5000) {
    return { status: 400, body: { error: "内容无效（1-5000 字）" } };
  }
  // 与真实路由一致的幂等合同：显式 id 冲突时返回既有行（离线队列回放/重复提交）
  const explicitId = typeof body?.id === "string" && body.id.trim() ? body.id.trim() : null;
  if (explicitId) {
    const existing = mockDb.memos.find((m) => m.id === explicitId);
    if (existing) return { body: existing };
  }
  const now = nowIso();
  const row = {
    id: explicitId ?? genId("memos"),
    user_id: MOCK_USER.id,
    content,
    tags: parseMemoTags(content),
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  mockDb.memos.push(row);
  return { status: 201, body: row };
};

const patchMemo: MockHandler = ({ body, params }) => {
  const content = String(body?.content || "").trim();
  if (!content || content.length > 5000) {
    return { status: 400, body: { error: "内容无效（1-5000 字）" } };
  }
  const row = mockDb.memos.find((m) => m.id === params.id && !m.deleted_at);
  if (!row) return { status: 500, body: { error: "速记不存在" } };
  row.content = content;
  row.tags = parseMemoTags(content);
  row.updated_at = nowIso();
  return { body: row };
};

// 与真实 DELETE 一致：未命中（已删/不存在）也返回 success
const deleteMemo: MockHandler = ({ params }) => {
  const row = mockDb.memos.find((m) => m.id === params.id && !m.deleted_at);
  if (row) row.deleted_at = nowIso();
  return { body: { success: true } };
};

// ---- 资料库统一查询（089 library_items RPC 的 mock 对齐实现）----
// 与真实路由逐字段对齐：view/limit/q/tags/cursor 语义 + 排序 + 响应形状 { items, nextCursor }。
// 排序 created_at DESC, source_type ASC, id ASC；游标三元组同规则过滤（见 lib/library/cursor.ts）。
const listLibraryItems: MockHandler = ({ url }) => {
  const viewRaw = url.searchParams.get("view") ?? "all";
  const view = viewRaw === "memos" ? "memo" : viewRaw;
  if (!["all", "reading", "memo"].includes(view)) {
    return { status: 400, body: { error: "view 无效（all|reading|memo）" } };
  }
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 100) : 30;
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const tags = (url.searchParams.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  let cursor = null;
  try {
    cursor = decodeLibraryCursor(url.searchParams.get("cursor"));
  } catch {
    return { status: 400, body: { error: "cursor 无效" } };
  }

  const tagNameById = new Map(
    (mockDb.tags || []).map((t: any) => [t.id as string, t.name as string])
  );
  const readingTags = (itemId: string): string[] =>
    (mockDb.item_tags || [])
      .filter((link: any) => link.item_id === itemId)
      .map((link: any) => tagNameById.get(link.tag_id))
      .filter((name): name is string => Boolean(name))
      .sort();

  const readingRows =
    view === "memo"
      ? []
      : (mockDb.reading_items || [])
          .filter((r: any) => !r.deleted_at)
          .map((r: any) => ({
            id: r.id,
            source_type: "reading",
            title: r.title ?? null,
            excerpt: r.excerpt ? String(r.excerpt).slice(0, 280) : null,
            url: r.url ?? null,
            tags: readingTags(r.id),
            reading_status: r.reading_status ?? null,
            is_pinned: Boolean(r.is_pinned),
            reading_progress: typeof r.reading_progress === "number" ? r.reading_progress : null,
            is_link_only: !r.content && !(r.url ?? "").startsWith("urn:organize:material:"),
            created_at: r.created_at,
            // 仅搜索用：真实 RPC 命中 title/excerpt/content，mock 侧用全量正文对齐
            _searchText: [r.title, r.excerpt, r.content].filter(Boolean).join("\n"),
          }));
  const memoRows =
    view === "reading"
      ? []
      : (mockDb.memos || [])
          .filter((m: any) => !m.deleted_at)
          .map((m: any) => ({
            id: m.id,
            source_type: "memo",
            title: null,
            excerpt: String(m.content ?? "").slice(0, 280),
            url: null,
            tags: [...((m.tags as string[] | undefined) ?? [])],
            reading_status: null,
            is_pinned: false,
            reading_progress: null,
            is_link_only: false,
            created_at: m.created_at,
            _searchText: String(m.content ?? ""),
          }));

  const filtered = [...readingRows, ...memoRows]
    .filter((row) => {
      if (q) {
        const haystack = (row as any)._searchText.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (tags.length) {
        // 两侧同一语义：标签名任一命中（reading 经 item_tags 归一为名称数组后与 memos.tags 一致）
        if (!(row.tags as string[]).some((t) => tags.includes(t))) return false;
      }
      if (cursor) {
        if (row.created_at > cursor.created_at) return false;
        if (row.created_at === cursor.created_at) {
          if (row.source_type < cursor.source_type) return false;
          if (row.source_type === cursor.source_type && row.id <= cursor.id) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      if (a.source_type !== b.source_type) return a.source_type < b.source_type ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const items = filtered.slice(0, limit).map(({ ...row }) => {
    delete (row as any)._searchText;
    return row;
  });
  const last = items[items.length - 1];
  const nextCursor =
    items.length === limit && last
      ? encodeLibraryCursor({
          created_at: last.created_at,
          source_type: last.source_type,
          id: last.id,
        })
      : null;
  return { body: { items, nextCursor } };
};

// ---- 文件导入（阶段 D，/api/imports 的 mock 对齐实现；阶段 1 可靠性同构）----
// 真实/mock 同一合同：响应 { task: {id,status}, files: ImportFileResult[] }；
// 幂等键 retry_key（结果回传 retryKey）；逐文件独立成败；中断恢复（stale 阈值）；
// 任务状态随文件重算；GET 游标分页。
// mock 诚实边界（任务书 §九：mock 不得伪造成功）：
//   文本路径（txt/md/csv/json）真解析（与服务端同一 extract-text 实现）并真建条目；
//   PDF/DOCX/XLSX 无服务端解析器 → 明确失败；image/audio 无存储 → 明确失败。
import { extractTextDocument } from "@/lib/imports/extract-text";
import { importKind } from "@/lib/imports/kinds";
import { validateImportBatch } from "@/lib/imports/budgets";
import { isImportError } from "@/lib/imports/errors";
import { IMPORT_URI_PREFIX } from "@/lib/reading/source";
import { INTERRUPTED_ERROR_MESSAGE, isImportRowStale } from "@/lib/imports/stale";
import {
  decodeImportHistoryCursor,
  encodeImportHistoryCursor,
  ImportHistoryCursorError,
} from "@/lib/imports/history-cursor";

// jsdom 的 Blob/File 无 arrayBuffer()，退回 FileReader（浏览器两条路都可用）
const blobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
    (n: number) => n.toString(16).padStart(2, "0"),
  ).join("");

const importTasksTable = () => (mockDb.import_tasks ??= []);
const importFilesTable = () => (mockDb.import_files ??= []);

const findImportRow = (retryKey: string) =>
  importFilesTable().find(
    (row: any) => row.user_id === MOCK_USER.id && row.retry_key === retryKey,
  );

const importFileDto = (row: any) => ({
  id: row.id,
  taskId: row.task_id,
  fileName: row.file_name,
  kind: row.kind,
  size: Number(row.size),
  status: row.status,
  error: row.error ?? null,
  readingItemId: row.reading_item_id ?? null,
  pageCount: row.page_count ?? null,
  createdAt: row.created_at,
  retryKey: row.retry_key,
});

/** 任务状态与逐文件状态对齐（与真实路由 recomputeTaskStatus 同语义）。 */
const recomputeImportTaskMock = (taskId: string): string => {
  const rows = importFilesTable().filter((row: any) => row.task_id === taskId);
  let status: string;
  if (rows.length === 0) {
    status = "failed";
  } else if (
    rows.some((row: any) => row.status === "pending" || row.status === "uploading" || row.status === "parsing")
  ) {
    status = "processing";
  } else {
    const saved = rows.filter((row: any) => row.status === "saved").length;
    const failed = rows.filter((row: any) => row.status === "failed").length;
    status = failed === 0 ? "saved" : saved === 0 ? "failed" : "partial";
  }
  const task = importTasksTable().find((t: any) => t.id === taskId);
  if (task) {
    task.status = status;
    task.updated_at = nowIso();
  }
  return status;
};

/** 惰性中断回收（与真实路由 recoverStaleImports 同语义）：stale 进行中行 → failed，任务收口。 */
const recoverStaleImportsMock = (): void => {
  const now = Date.now();
  for (const row of importFilesTable()) {
    if (row.user_id !== MOCK_USER.id) continue;
    if ((row.status === "uploading" || row.status === "parsing") && isImportRowStale(row.updated_at, now)) {
      row.status = "failed";
      row.error = INTERRUPTED_ERROR_MESSAGE;
      row.updated_at = nowIso();
    }
  }
  const touched = new Set(
    importTasksTable().filter((t: any) => t.user_id === MOCK_USER.id).map((t: any) => t.id),
  );
  for (const taskId of touched) recomputeImportTaskMock(taskId);
};

const IMPORT_UNSUPPORTED_MESSAGE = (name: string) =>
  `暂不支持「${name}」：可导入 TXT / Markdown / CSV / JSON / PDF / DOCX / XLSX、图片与音频；旧版 .doc/.xls 请转换为 .docx/.xlsx`;

const importOneMockFile = async (
  file: File,
  retryKey: string,
  ensureTaskId: () => string,
): Promise<ReturnType<typeof importFileDto>> => {
  const kind = importKind(file);
  const now = Date.now();

  // 幂等 + 中断恢复（与真实路由同语义）：新鲜非 failed 行原样返回；
  // stale 进行中行 / failed 行原地重跑（复用同一行）
  let row: any = findImportRow(retryKey);
  const interrupted = !!row && row.status !== "failed" && isImportRowStale(row.updated_at, now);
  if (row && row.status !== "failed" && !interrupted) return importFileDto(row);

  const touch = (fields: Record<string, unknown>) => {
    Object.assign(row, fields, { updated_at: nowIso() });
    return importFileDto(row);
  };

  const fail = async (error: string) => {
    if (row) return touch({ status: "failed", error });
    // 无行失败（不支持格式等）：也落一行失败记录——历史完整、任务状态一致、可重试
    const newRow: any = {
      id: genId("import_file"), task_id: ensureTaskId(), user_id: MOCK_USER.id,
      file_name: file.name, mime: file.type || "application/octet-stream", size: file.size,
      kind: kind ?? "text", retry_key: retryKey, status: "failed", error,
      reading_item_id: null, page_count: null,
      created_at: nowIso(), updated_at: nowIso(),
    };
    // push 前再查一次（并发窗口兜底，与真实路由唯一约束同语义）
    const dup = findImportRow(retryKey);
    if (dup) {
      row = dup;
      return touch({ status: "failed", error });
    }
    importFilesTable().push(newRow);
    row = newRow;
    return importFileDto(row);
  };

  if (!kind) return fail(IMPORT_UNSUPPORTED_MESSAGE(file.name));
  if (kind === "pdf" || kind === "docx" || kind === "xlsx") {
    return fail(`「${file.name}」：mock 后端不支持解析 ${kind.toUpperCase()}（需真实后端），已拒绝，未伪造结果`);
  }
  if (kind === "image" || kind === "audio") {
    return fail(`「${file.name}」：mock 后端不支持原件存储，已拒绝，未伪造结果`);
  }

  // 文本路径：真实解析 + 真实建条目（URN 去重与真实后端同语义）
  try {
    const bytes = await blobBytes(file);
    const doc = extractTextDocument(kind, { fileName: file.name, bytes });
    const key = await sha256Hex(bytes);
    const urn = `${IMPORT_URI_PREFIX}${key}`;
    const dup = (mockDb.reading_items || []).find(
      (r: any) => r.user_id === MOCK_USER.id && r.url === urn && !r.deleted_at,
    );
    let itemId = dup?.id ?? null;
    if (!dup) {
      itemId = genId("item");
      mockDb.reading_items.push({
        id: itemId,
        user_id: MOCK_USER.id,
        url: urn,
        title: doc.title,
        content: doc.html,
        excerpt: doc.excerpt,
        cover_image: null,
        reading_status: "unread",
        reading_progress: 0,
        is_pinned: false,
        created_at: nowIso(),
        updated_at: nowIso(),
        tags: [],
      });
    }
    if (!row) {
      // await 期间同键行可能已被并发请求落行——复用之（幂等，不建第二行）
      row = findImportRow(retryKey);
    }
    if (!row) {
      row = {
        id: genId("import_file"), task_id: ensureTaskId(), user_id: MOCK_USER.id,
        file_name: file.name, mime: file.type || "application/octet-stream", size: file.size,
        kind, retry_key: retryKey, status: "uploading", error: null,
        reading_item_id: null, page_count: null,
        created_at: nowIso(), updated_at: nowIso(),
      };
      const raced = findImportRow(retryKey);
      if (!raced) importFilesTable().push(row);
      else row = raced;
    }
    return touch({ status: "saved", error: null, reading_item_id: itemId, page_count: null });
  } catch (error) {
    return fail(isImportError(error) ? error.message : `解析失败：${String(error).slice(0, 200)}`);
  }
};

const createImportShim: MockHandler = async ({ rawBody }) => {
  if (!(rawBody instanceof FormData)) {
    return { status: 400, body: { error: "请求格式无效（multipart/form-data）" } };
  }
  const files = rawBody.getAll("files").filter((v): v is File => v instanceof File);
  const retryKeys = rawBody.getAll("retryKeys").map(String);
  const batchError = validateImportBatch(files);
  if (batchError) return { status: 400, body: { error: batchError } };
  if (retryKeys.length && retryKeys.length !== files.length) {
    return { status: 400, body: { error: "retryKeys 与 files 数量不一致" } };
  }

  // 任务行惰性创建：纯重试批不产生空任务（与真实路由同语义）
  let taskId: string | null = null;
  const ensureTaskId = () => {
    if (!taskId) {
      taskId = genId("import_task");
      importTasksTable().push({
        id: taskId, user_id: MOCK_USER.id, status: "processing",
        created_at: nowIso(), updated_at: nowIso(),
      });
    }
    return taskId;
  };

  const results = [];
  for (let i = 0; i < files.length; i++) {
    const retryKey = retryKeys[i] ?? `${ensureTaskId()}:${i}`;
    results.push(await importOneMockFile(files[i], retryKey, ensureTaskId));
  }

  // 收口：被触碰的任务全部重算（失败项修好 → partial 收口为 saved）
  for (const id of [...new Set(results.map((r: any) => r.taskId))]) {
    recomputeImportTaskMock(id);
  }
  const primaryTaskId = taskId ?? results[0]?.taskId ?? "";
  const task = importTasksTable().find((t: any) => t.id === primaryTaskId);
  return { body: { task: { id: primaryTaskId, status: task?.status ?? "failed" }, files: results } };
};

const listImportsShim: MockHandler = ({ url }) => {
  recoverStaleImportsMock();
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 100) : 50;
  let cursor;
  try {
    cursor = decodeImportHistoryCursor(url.searchParams.get("cursor"));
  } catch (error) {
    const message = error instanceof ImportHistoryCursorError ? error.message : "cursor 无效";
    return { status: 400, body: { error: message } };
  }
  const all = importFilesTable()
    .filter((row: any) => row.user_id === MOCK_USER.id)
    .slice()
    .sort((a: any, b: any) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return a.id < b.id ? 1 : -1; // created_at DESC, id DESC
    });
  const page = cursor
    ? all.filter(
        (row: any) =>
          row.created_at < cursor.created_at ||
          (row.created_at === cursor.created_at && row.id < cursor.id),
      )
    : all;
  const files = page.slice(0, limit).map(importFileDto);
  const last = files.length === limit ? files[files.length - 1] : null;
  const nextCursor = last
    ? encodeImportHistoryCursor({ created_at: last.createdAt, id: last.id })
    : null;
  return { body: { files, nextCursor } };
};

// ---- 备份恢复（P2-01 smoke 需要；与真实 /api/backup/restore 同形状）----
// 真实语义：仅允许恢复到空账户（非空 409）；整体替换写入。
// mock 下按 payload 逐表替换 MOCK_USER 的行（smoke 级往返，不做服务端深校验——
// 预检 validateManifest 已在客户端完成）。
const restoreBackup: MockHandler = ({ body }) => {
  const data = body?.data as Record<string, any[]> | undefined;
  if (!data || typeof data !== "object") {
    return { status: 400, body: { error: "备份缺少 data", code: "INVALID_BACKUP" } };
  }
  const CORE_TABLES = ["reading_items", "notes", "tasks", "tags", "memos"];
  const nonEmpty = CORE_TABLES.some(
    (table) => (mockDb[table] || []).some((row) => row.user_id === MOCK_USER.id)
  );
  if (nonEmpty) {
    return {
      status: 409,
      body: { error: "只允许恢复到空账户", code: "ACCOUNT_NOT_EMPTY" },
    };
  }
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    if (!(table in mockDb)) mockDb[table] = [];
    // 整体替换当前用户的行（备份行统一归属 MOCK_USER）
    const others = (mockDb[table] || []).filter((row) => row.user_id !== MOCK_USER.id);
    mockDb[table] = others.concat(rows.map((row) => ({ ...row, user_id: MOCK_USER.id })));
    counts[table] = rows.length;
  }
  // 087 真实 RPC 会把画布 revision 复位为 1（备份导出不含 revision 列）
  for (const row of mockDb.canvas_documents || []) {
    if (typeof row.revision !== "number") row.revision = 1;
  }
  return { body: { success: true, counts } };
};

// ---- 任务到期兜底（桌面壳轮询用）----

// mockDb 无时间推演语义（任务 schedule 不随真实时钟流动），返回空列表，
// 轮询方按「本周期无提醒」消费即可
const listDueSoonTasks: MockHandler = () => ({ body: [] });

// ---- 同步区块（R05：revision 乐观锁与真实 route 同形状）----

const listSyncedBlocks: MockHandler = ({ url }) => {
  const idsParam = url.searchParams.get("ids");
  const rows = mockDb.synced_blocks.filter((row) => row.user_id === MOCK_USER.id);
  if (!idsParam) return { body: rows };
  const ids = new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean));
  return { body: rows.filter((row) => ids.has(row.id)) };
};

const createSyncedBlock: MockHandler = ({ body }) => {
  const id = typeof body?.id === "string" && body.id.length ? body.id : genId("synced_blocks");
  // 与真实 route 一致：主键冲突返回 500（insert .single() 报错）
  if (mockDb.synced_blocks.some((r) => r.id === id)) {
    return { status: 500, body: { error: `duplicate key value violates unique constraint "synced_blocks_pkey"` } };
  }
  const row = {
    id,
    user_id: MOCK_USER.id,
    content: Array.isArray(body?.content) ? body.content : [],
    revision: 1,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  mockDb.synced_blocks.push(row);
  return { status: 201, body: row };
};

const patchSyncedBlock: MockHandler = ({ body, params }) => {
  const row = mockDb.synced_blocks.find(
    (r) => r.id === params.id && r.user_id === MOCK_USER.id
  );
  if (!row) return { status: 404, body: { error: "同步区块不存在" } };
  const content = Array.isArray(body?.content) ? body.content : [];
  const expected =
    typeof body?.expected_revision === "number" && Number.isInteger(body.expected_revision)
      ? body.expected_revision
      : null;
  if (expected !== null && row.revision !== expected) {
    // 与真实 409 形状一致：current 带服务端当前 revision/content
    return {
      status: 409,
      body: {
        error: "同步区块已被其他修改更新",
        current: { revision: row.revision, content: row.content },
      },
    };
  }
  row.content = content;
  row.revision = (expected ?? row.revision ?? 1) + 1;
  row.updated_at = nowIso();
  return { body: { id: row.id, content: row.content, revision: row.revision, updated_at: row.updated_at } };
};

const deleteSyncedBlock: MockHandler = ({ params }) => {
  mockDb.synced_blocks = mockDb.synced_blocks.filter(
    (r) => !(r.id === params.id && r.user_id === MOCK_USER.id)
  );
  return { body: { ok: true } };
};

// ---- 构思画布（/api/canvases；与真实路由逐字段对齐，CAS 语义同 085 RPC）----

const CANVAS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const findCanvasRow = (id: string, includeDeleted = false) =>
  mockDb.canvas_documents?.find(
    (r: any) => r.id === id && r.user_id === MOCK_USER.id && (includeDeleted || !r.deleted_at)
  );

const listCanvasesShim: MockHandler = () => {
  const rows = (mockDb.canvas_documents || [])
    .filter((r: any) => r.user_id === MOCK_USER.id && !r.deleted_at)
    .sort((a: any, b: any) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, 200)
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  return { body: { canvases: rows } };
};

const createCanvasShim: MockHandler = ({ body }) => {
  const id = typeof body?.id === "string" && CANVAS_UUID_RE.test(body.id) ? body.id : null;
  if (!id) return { status: 400, body: { error: "缺少合法的文档 ID" } };
  // 幂等命中：同用户已有同 ID 行 → 返回既有行
  const existing = findCanvasRow(id, true);
  if (existing) return { status: 200, body: existing };
  const title = typeof body?.title === "string" ? body.title.slice(0, 200) : "";
  // B1：v1 输入先迁移再校验，落库一律写迁移后的 v2（防旧客户端写入丢 Region 层级）
  let content: unknown =
    body?.content !== undefined
      ? body.content
      : { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] };
  if (body?.content !== undefined) {
    const validation = validateCanvasContent(body.content, { allowMockImages: true });
    if (!validation.ok) {
      return { status: 400, body: { error: "画布内容校验失败", errors: validation.errors } };
    }
    content = validation.doc;
  }
  const row: any = {
    id,
    user_id: MOCK_USER.id,
    title,
    content,
    revision: 1,
    deleted_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  mockDb.canvas_documents.push(row);
  return { status: 201, body: row };
};

const getCanvasShim: MockHandler = ({ params }) => {
  const row = findCanvasRow(params.id);
  if (!row) return { status: 404, body: { error: "文档不存在" } };
  return {
    body: {
      id: row.id,
      title: row.title,
      // B1：读取侧统一走 ensureCanvasDocV2（v1 自动迁移为 v2）
      content: ensureCanvasDocV2(row.content),
      revision: row.revision,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  };
};

const patchCanvasShim: MockHandler = ({ body, params }) => {
  const row = findCanvasRow(params.id);
  if (!row) return { status: 404, body: { error: "文档不存在" } };
  let nextContent: unknown;
  if (body?.content !== undefined) {
    const validation = validateCanvasContent(body.content, { allowMockImages: true });
    if (!validation.ok) {
      return { status: 400, body: { error: "画布内容校验失败", errors: validation.errors } };
    }
    nextContent = validation.doc;
  }
  const expected =
    typeof body?.expected_revision === "number" && Number.isFinite(body.expected_revision)
      ? Math.trunc(body.expected_revision)
      : null;
  if (expected !== null && row.revision !== expected) {
    // 与真实 409 形状一致：current 带服务端当前 revision
    return {
      status: 409,
      body: {
        error: "画布已被其他标签页或设备修改",
        current: { revision: row.revision },
      },
    };
  }
  row.title = typeof body?.title === "string" ? body.title.slice(0, 200) : row.title;
  if (body?.content !== undefined) row.content = nextContent;
  row.revision = row.revision + 1;
  row.updated_at = nowIso();
  return {
    body: { id: row.id, revision: row.revision, updated_at: row.updated_at },
  };
};

const deleteCanvasShim: MockHandler = ({ params }) => {
  const row = findCanvasRow(params.id);
  if (!row) return { status: 404, body: { error: "文档不存在" } };
  row.deleted_at = nowIso();
  return { body: { success: true, affected: 1 } };
};

// ---- 垃圾箱（对齐 list_trash / mutate_trash RPC 的返回形状）----

// 真实实现是两个 RPC；mock 下按「表 → 资源类型」映射扫 deleted_at 非空的行。
// 只覆盖有软删除列的表，database 走 /api/databases（mock 未实现）故不在表内。
const TRASH_SOURCES: Array<{ table: string; type: string; titleOf: (row: any) => string }> = [
  { table: "notes", type: "note", titleOf: (r) => r.title || "无标题笔记" },
  { table: "reading_items", type: "reading_item", titleOf: (r) => r.title || r.url || "无标题文章" },
  { table: "tasks", type: "task", titleOf: (r) => r.title || "无标题任务" },
  { table: "lessons", type: "lesson", titleOf: (r) => r.title || "无标题经验" },
  { table: "countdown_days", type: "countdown", titleOf: (r) => r.title || "无标题倒数日" },
  { table: "memos", type: "memo", titleOf: (r) => (r.content || "").slice(0, 60) || "空速记" },
  { table: "canvas_documents", type: "canvas_document", titleOf: (r) => r.title || "未命名画布" },
];

const listTrash: MockHandler = ({ url }) => {
  const wanted = url.searchParams.get("resource_type");
  const rows: Array<{ resource_type: string; id: string; title: string; deleted_at: string }> = [];
  for (const src of TRASH_SOURCES) {
    if (wanted && wanted !== src.type) continue;
    for (const row of mockDb[src.table] || []) {
      if (row.user_id !== MOCK_USER.id || !row.deleted_at) continue;
      rows.push({
        resource_type: src.type,
        id: row.id,
        title: src.titleOf(row),
        deleted_at: row.deleted_at,
      });
    }
  }
  rows.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
  return { body: rows };
};

const mutateTrash: MockHandler = ({ body }) => {
  const action = body?.action;
  const type = body?.resource_type;
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  const src = TRASH_SOURCES.find((s) => s.type === type);
  if (!src || (action !== "restore" && action !== "permanent_delete")) {
    return { status: 400, body: { error: "垃圾箱操作无效", code: "INVALID_TRASH_MUTATION" } };
  }
  const idSet = new Set(ids);
  const table = mockDb[src.table] || [];
  const hit = table.filter((r) => r.user_id === MOCK_USER.id && r.deleted_at && idSet.has(r.id));
  if (action === "restore") {
    hit.forEach((r) => { r.deleted_at = null; });
  } else {
    mockDb[src.table] = table.filter((r) => !hit.includes(r));
  }
  return { body: { success: true, affected: hit.length } };
};

// ---- 插件配置（mock 下不落库也要能开关，否则每页都弹"插件配置读取失败"）----

const listPlugins: MockHandler = () => ({
  body: mockDb.plugins.filter((row) => row.user_id === MOCK_USER.id),
});

const patchPlugin: MockHandler = ({ body, params }) => {
  const row = mockDb.plugins.find((r) => r.id === params.id && r.user_id === MOCK_USER.id);
  if (!row) return { status: 500, body: { error: "插件不存在" } };
  if (body?.config !== undefined) row.config = body.config;
  if (body?.enabled !== undefined) row.enabled = body.enabled;
  row.updated_at = nowIso();
  return { body: row };
};

const upsertPlugin: MockHandler = ({ body }) => {
  const packageName = typeof body?.package_name === "string" ? body.package_name : null;
  const name = typeof body?.name === "string" ? body.name : null;
  if (!packageName || !name) {
    return { status: 400, body: { error: "name 和 package_name 为必填项" } };
  }
  const existing = mockDb.plugins.find(
    (r) => r.user_id === MOCK_USER.id && r.package_name === packageName
  );
  if (existing) {
    existing.name = name;
    if (body?.config !== undefined) existing.config = body.config;
    existing.enabled = true;
    existing.updated_at = nowIso();
    return { status: 201, body: existing };
  }
  const row = {
    id: genId("plugins"),
    user_id: MOCK_USER.id,
    name,
    package_name: packageName,
    version: body?.version ?? null,
    config: body?.config ?? {},
    enabled: true,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  mockDb.plugins.push(row);
  return { status: 201, body: row };
};

const ROUTES: MockRoute[] = [
  { method: "GET", pattern: /^\/api\/notes\/([^/]+)\/versions$/, handler: listVersions },
  { method: "GET", pattern: /^\/api\/notes\/([^/]+)\/versions\/([^/]+)$/, handler: getVersion },
  { method: "POST", pattern: /^\/api\/notes\/([^/]+)\/versions\/([^/]+)$/, handler: restoreVersion },
  { method: "DELETE", pattern: /^\/api\/notes\/([^/]+)\/versions\/([^/]+)$/, handler: deleteVersion },
  { method: "GET", pattern: /^\/api\/notes\/([^/]+)\/comments$/, handler: listCommentThreads },
  { method: "POST", pattern: /^\/api\/notes\/([^/]+)\/comments$/, handler: createComment },
  { method: "PATCH", pattern: /^\/api\/notes\/([^/]+)\/comments$/, handler: patchComment },
  { method: "DELETE", pattern: /^\/api\/notes\/([^/]+)\/comments$/, handler: deleteComment },
  { method: "GET", pattern: /^\/api\/notes\/([^/]+)\/suggestions$/, handler: listSuggestions },
  { method: "POST", pattern: /^\/api\/notes\/([^/]+)\/suggestions$/, handler: createSuggestion },
  { method: "PATCH", pattern: /^\/api\/notes\/([^/]+)\/suggestions$/, handler: patchSuggestion },
  { method: "POST", pattern: /^\/api\/notes\/([^/]+)\/move-block$/, handler: moveBlock },
  { method: "GET", pattern: /^\/api\/memos$/, handler: listMemos },
  { method: "GET", pattern: /^\/api\/library\/items$/, handler: listLibraryItems },
  { method: "POST", pattern: /^\/api\/imports$/, handler: createImportShim },
  { method: "GET", pattern: /^\/api\/imports$/, handler: listImportsShim },
  // 主题集合（阶段 3）：独立模块，工厂注入同一 mockDb
  ...createCollectionRoutes({ mockDb, MOCK_USER, genId, nowIso }),
  { method: "POST", pattern: /^\/api\/memos$/, handler: createMemo },
  { method: "GET", pattern: /^\/api\/memos\/tags$/, handler: listMemoTags },
  { method: "GET", pattern: /^\/api\/memos\/([^/]+)$/, handler: getMemo },
  { method: "PATCH", pattern: /^\/api\/memos\/([^/]+)$/, handler: patchMemo },
  { method: "DELETE", pattern: /^\/api\/memos\/([^/]+)$/, handler: deleteMemo },
  { method: "GET", pattern: /^\/api\/tasks\/due-soon$/, handler: listDueSoonTasks },
  { method: "POST", pattern: /^\/api\/backup\/restore$/, handler: restoreBackup },
  { method: "GET", pattern: /^\/api\/synced-blocks$/, handler: listSyncedBlocks },
  { method: "POST", pattern: /^\/api\/synced-blocks$/, handler: createSyncedBlock },
  { method: "PATCH", pattern: /^\/api\/synced-blocks\/([^/]+)$/, handler: patchSyncedBlock },
  { method: "DELETE", pattern: /^\/api\/synced-blocks\/([^/]+)$/, handler: deleteSyncedBlock },
  { method: "GET", pattern: /^\/api\/trash$/, handler: listTrash },
  { method: "POST", pattern: /^\/api\/trash$/, handler: mutateTrash },
  { method: "GET", pattern: /^\/api\/canvases$/, handler: listCanvasesShim },
  { method: "POST", pattern: /^\/api\/canvases$/, handler: createCanvasShim },
  { method: "GET", pattern: /^\/api\/canvases\/([^/]+)$/, handler: getCanvasShim },
  { method: "PATCH", pattern: /^\/api\/canvases\/([^/]+)$/, handler: patchCanvasShim },
  { method: "DELETE", pattern: /^\/api\/canvases\/([^/]+)$/, handler: deleteCanvasShim },
  { method: "GET", pattern: /^\/api\/plugins$/, handler: listPlugins },
  { method: "POST", pattern: /^\/api\/plugins$/, handler: upsertPlugin },
  { method: "PATCH", pattern: /^\/api\/plugins\/([^/]+)$/, handler: patchPlugin },
];

const jsonResponse = (body: unknown, status: number, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });

/**
 * 安装 mock API 拦截。幂等（HMR 重载不会叠加补丁）。
 * 只拦截同源 /api/*：命中路由走 mockDb 实现，未命中返回 501 明确报错，
 * 其余请求原样透传给真实 fetch。
 */
export function installMockApiShim() {
  if (typeof window === "undefined") return;
  const flag = window as typeof window & { __organizeMockApiShimInstalled?: boolean };
  if (flag.__organizeMockApiShimInstalled) return;
  flag.__organizeMockApiShimInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    let pathname = "";
    try {
      pathname = new URL(rawUrl, window.location.origin).pathname;
    } catch {
      return originalFetch(input, init);
    }
    if (!pathname.startsWith("/api/")) return originalFetch(input, init);

    const method = (init?.method ?? "GET").toUpperCase();
    const route = ROUTES.find((r) => r.method === method && r.pattern.test(pathname));
    if (!route) {
      return jsonResponse(
        { error: `mock 后端未实现该接口：${method} ${pathname}（见 lib/mock/api-shim.ts）` },
        501
      );
    }
    try {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const values = pathname.match(route.pattern)!.slice(1);
      const params: Record<string, string> = { id: values[0], versionId: values[1] };
      const result = await route.handler({
        body, params, url: new URL(rawUrl, window.location.origin), rawBody: init?.body,
      });
      return jsonResponse(result.body, result.status ?? 200, result.headers);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "mock 处理失败" },
        500
      );
    }
  };
}
