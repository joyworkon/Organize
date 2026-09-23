import {
  isCollectionSourceType,
  validateCollectionName,
  type CollectionItemView,
  type CollectionSourceType,
  type CollectionSummary,
} from "@/lib/collections/types";
import {
  decodeCollectionCursor,
  encodeCollectionCursor,
} from "@/lib/collections/cursor";

// ---- 主题集合（阶段 3）mock shim：与 /api/collections* 真实路由逐字段对齐 ----
// mockDb 内存表：collections / collection_items（引用坐标），来源实时 join
// mockDb.reading_items / memos / import_files（与 092 RPC 同语义：软删 → available=false）。

type MockHandlerResult = { status?: number; body: unknown };
type ShimHandler = (ctx: {
  body: any;
  params: Record<string, string>;
  url: URL;
}) => MockHandlerResult | Promise<MockHandlerResult>;

interface ShimRoute {
  method: string;
  pattern: RegExp;
  handler: ShimHandler;
}

interface ShimDeps {
  mockDb: Record<string, any[]>;
  MOCK_USER: { id: string };
  genId: (table: string) => string;
  nowIso: () => string;
}

/** api-shim.ts 接线：createCollectionRoutes({ mockDb, MOCK_USER, genId, nowIso }) */
export function createCollectionRoutes(deps: ShimDeps): ShimRoute[] {
  const collectionsTable = () => (deps.mockDb.collections ??= []);
  const itemsTable = () => (deps.mockDb.collection_items ??= []);

const summaryOf = (row: any): CollectionSummary => ({
  id: row.id,
  name: row.name,
  itemCount: itemsTable().filter((r: any) => r.collection_id === row.id).length,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** 实时 join 来源（092 RPC 同语义）：软删/不可达 → available=false */
function joinSource(row: any): CollectionItemView {
  const db = deps.mockDb;
  if (row.reading_item_id) {
    const src = (db.reading_items ?? []).find(
      (r: any) => r.id === row.reading_item_id && r.user_id === deps.MOCK_USER.id && !r.deleted_at,
    );
    return {
      id: row.id, sourceType: "reading", sourceId: row.reading_item_id,
      title: src?.title ?? null, excerpt: (src?.excerpt ?? "").slice(0, 280) || null,
      available: !!src, readingItemId: row.reading_item_id, fileName: null,
      createdAt: row.created_at,
    };
  }
  if (row.memo_id) {
    const src = (db.memos ?? []).find(
      (m: any) => m.id === row.memo_id && m.user_id === deps.MOCK_USER.id && !m.deleted_at,
    );
    return {
      id: row.id, sourceType: "memo", sourceId: row.memo_id,
      title: null, excerpt: src ? String(src.content).slice(0, 280) : null,
      available: !!src, readingItemId: null, fileName: null,
      createdAt: row.created_at,
    };
  }
  const src = (db.import_files ?? []).find(
    (f: any) => f.id === row.import_file_id && f.user_id === deps.MOCK_USER.id,
  );
  return {
    id: row.id, sourceType: "file", sourceId: row.import_file_id,
    title: src?.file_name ?? null, excerpt: null,
    available: !!src, readingItemId: src?.reading_item_id ?? null,
    fileName: src?.file_name ?? null,
    createdAt: row.created_at,
  };
}

const listCollectionsShim: ShimHandler = () => {
  const rows = collectionsTable()
    .filter((row: any) => row.user_id === deps.MOCK_USER.id)
    .slice()
    .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
  return { body: { collections: rows.map(summaryOf) } };
};

const createCollectionShim: ShimHandler = ({ body }) => {
  const nameError = validateCollectionName(body?.name);
  if (nameError) return { status: 400, body: { error: nameError } };
  const row = {
    id: deps.genId("collection"),
    user_id: deps.MOCK_USER.id,
    name: String(body.name).trim(),
    created_at: deps.nowIso(),
    updated_at: deps.nowIso(),
  };
  collectionsTable().push(row);
  return { body: { collection: summaryOf(row) } };
};

const patchCollectionShim: ShimHandler = ({ body, params }) => {
  const nameError = validateCollectionName(body?.name);
  if (nameError) return { status: 400, body: { error: nameError } };
  const row = collectionsTable().find(
    (r: any) => r.id === params.id && r.user_id === deps.MOCK_USER.id,
  );
  if (!row) return { status: 404, body: { error: "集合不存在" } };
  row.name = String(body.name).trim();
  row.updated_at = deps.nowIso();
  return { body: { success: true } };
};

const deleteCollectionShim: ShimHandler = ({ params }) => {
  const table = collectionsTable();
  const index = table.findIndex(
    (r: any) => r.id === params.id && r.user_id === deps.MOCK_USER.id,
  );
  if (index < 0) return { status: 404, body: { error: "集合不存在" } };
  table.splice(index, 1);
  // cascade 清引用行；来源不动
  const items = itemsTable();
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].collection_id === params.id) items.splice(i, 1);
  }
  return { body: { success: true } };
};

const listItemsShim: ShimHandler = ({ params, url }) => {
  const collection = collectionsTable().find(
    (r: any) => r.id === params.id && r.user_id === deps.MOCK_USER.id,
  );
  if (!collection) return { status: 404, body: { error: "集合不存在" } };
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 200) : 50;
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  let cursor = null;
  try {
    cursor = decodeCollectionCursor(url.searchParams.get("cursor"));
  } catch (error) {
    return { status: 400, body: { error: `cursor 无效：${(error as Error).message}` } };
  }
  let rows = itemsTable()
    .filter((r: any) => r.collection_id === params.id && r.user_id === deps.MOCK_USER.id)
    .map(joinSource);
  if (q) {
    rows = rows.filter(
      (r: CollectionItemView) =>
        (r.title ?? "").toLowerCase().includes(q) ||
        (r.excerpt ?? "").toLowerCase().includes(q) ||
        (r.fileName ?? "").toLowerCase().includes(q),
    );
  }
  rows = rows.sort((a: CollectionItemView, b: CollectionItemView) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? -1 : 1; // 同刻度 id ASC（与 092 RPC 排序一致）
  });
  if (cursor) {
    rows = rows.filter(
      (r: CollectionItemView) =>
        r.createdAt < cursor.created_at ||
        (r.createdAt === cursor.created_at && r.id > cursor.id),
    );
  }
  const page = rows.slice(0, limit);
  const last = page.length === limit ? page[page.length - 1] : null;
  return {
    body: {
      items: page,
      nextCursor: last ? encodeCollectionCursor({ created_at: last.createdAt, id: last.id }) : null,
    },
  };
};

const addItemsShim: ShimHandler = ({ body, params }) => {
  const sourceType = body?.sourceType;
  if (!isCollectionSourceType(sourceType)) {
    return { status: 400, body: { error: "sourceType 无效" } };
  }
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === "string" && v.length > 0).slice(0, 100)
    : [];
  if (!ids.length) return { status: 400, body: { error: "ids 不能为空" } };
  const collection = collectionsTable().find(
    (r: any) => r.id === params.id && r.user_id === deps.MOCK_USER.id,
  );
  if (!collection) return { status: 404, body: { error: "集合不存在" } };

  const db = deps.mockDb;
  const column: Record<CollectionSourceType, string> = {
    reading: "reading_item_id", memo: "memo_id", file: "import_file_id",
  };
  let added = 0;
  for (const sourceId of ids) {
    // 来源必须真实存在（对应真实侧 FK 23503 → 400「来源不存在或不可访问」）
    const exists =
      sourceType === "reading"
        ? (db.reading_items ?? []).some((r: any) => r.id === sourceId && r.user_id === deps.MOCK_USER.id)
        : sourceType === "memo"
          ? (db.memos ?? []).some((m: any) => m.id === sourceId && m.user_id === deps.MOCK_USER.id)
          : (db.import_files ?? []).some((f: any) => f.id === sourceId && f.user_id === deps.MOCK_USER.id);
    if (!exists) return { status: 400, body: { error: "来源不存在或不可访问" } };
    // 幂等：同 (collection, source) 只一行
    const dup = itemsTable().some(
      (r: any) => r.collection_id === params.id && r[column[sourceType]] === sourceId,
    );
    if (dup) continue;
    itemsTable().push({
      id: deps.genId("collection_item"),
      collection_id: params.id,
      user_id: deps.MOCK_USER.id,
      [column[sourceType]]: sourceId,
      created_at: deps.nowIso(),
    });
    added += 1;
  }
  collection.updated_at = deps.nowIso();
  return { body: { added } };
};

const removeItemShim: ShimHandler = ({ params, url }) => {
  const itemId = url.searchParams.get("itemId");
  if (!itemId) return { status: 400, body: { error: "缺少 itemId" } };
  const items = itemsTable();
  const index = items.findIndex(
    (r: any) => r.id === itemId && r.user_id === deps.MOCK_USER.id,
  );
  if (index < 0) return { status: 404, body: { error: "引用行不存在" } };
  items.splice(index, 1);
  return { body: { success: true } };
};

return [
  { method: "GET", pattern: /^\/api\/collections$/, handler: listCollectionsShim },
  { method: "POST", pattern: /^\/api\/collections$/, handler: createCollectionShim },
  { method: "PATCH", pattern: /^\/api\/collections\/([^/]+)$/, handler: patchCollectionShim },
  { method: "DELETE", pattern: /^\/api\/collections\/([^/]+)$/, handler: deleteCollectionShim },
  { method: "GET", pattern: /^\/api\/collections\/([^/]+)\/items$/, handler: listItemsShim },
  { method: "POST", pattern: /^\/api\/collections\/([^/]+)\/items$/, handler: addItemsShim },
  { method: "DELETE", pattern: /^\/api\/collections\/([^/]+)\/items$/, handler: removeItemShim },
];
}
