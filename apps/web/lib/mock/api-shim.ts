// mock 后端的浏览器端 fetch 拦截层：把笔记历史版本、块评论、块建议、跨笔记移动块
// 等 /api/* 调用路由到内存 mockDb 实现，让这些功能在无 Docker/Supabase 的
// 开发机（NEXT_PUBLIC_MOCK_BACKEND=true）上可用。
// 由 lib/supabase/client.ts 在 mock 模式下模块加载时同步安装（先于任何组件 effect）。
// 不在覆盖范围（保持直连、由调用方按失败降级）：AI（/api/ai/*）、上传（/api/upload）、
// 数据库块（/api/databases*）、未登录 cron 类接口。
import { mockDb, MOCK_USER } from "@/lib/supabase/mock-data";
import { parseMemoTags } from "@/lib/memos/tags";

type MockHandlerResult = { status?: number; body: unknown };
type MockHandler = (ctx: {
  body: any;
  params: Record<string, string>;
  url: URL;
}) => MockHandlerResult;

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
  const rows = mockDb.memos
    .filter((m) => !m.deleted_at && (!tag || (m.tags as string[]).includes(tag)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { body: rows };
};

const createMemo: MockHandler = ({ body }) => {
  const content = String(body?.content || "").trim();
  if (!content || content.length > 5000) {
    return { status: 400, body: { error: "内容无效（1-5000 字）" } };
  }
  const now = nowIso();
  const row = {
    id: genId("memos"),
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
  { method: "POST", pattern: /^\/api\/memos$/, handler: createMemo },
  { method: "PATCH", pattern: /^\/api\/memos\/([^/]+)$/, handler: patchMemo },
  { method: "DELETE", pattern: /^\/api\/memos\/([^/]+)$/, handler: deleteMemo },
];

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
      const result = route.handler({ body, params, url: new URL(rawUrl, window.location.origin) });
      return jsonResponse(result.body, result.status ?? 200);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "mock 处理失败" },
        500
      );
    }
  };
}
