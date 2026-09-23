// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// 阶段 3 /api/collections* 的 mock shim 路由测试（与真实路由逐字段对齐）：
// 创建/重命名/删除（来源不动）、加入幂等、软删来源 available=false、游标分页。
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const call = async (path: string, init?: RequestInit) => {
  const res = await (window as any).fetch(path, init);
  return { status: res.status, body: await res.json() };
};

let userId: string;

beforeEach(async () => {
  vi.resetModules();
  (window as any).fetch = vi.fn(async () => new Response("{}", { status: 200 }));
  delete (window as any).__organizeMockApiShimInstalled;
  const mod = await import("@/lib/mock/api-shim");
  mod.installMockApiShim();
  const { mockDb, MOCK_USER } = await import("@/lib/supabase/mock-data");
  userId = MOCK_USER.id;
  mockDb.collections = [];
  mockDb.collection_items = [];
  // 来源种子：一条阅读条目 + 一条速记 + 一条导入文件
  mockDb.reading_items.push({
    id: "col-reading-1", user_id: userId, url: "https://example.com/a",
    title: "集合文章", excerpt: "摘要", content: "<p>正文</p>",
    reading_status: "unread", reading_progress: 0, is_pinned: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), tags: [],
  });
  mockDb.memos.push({
    id: "col-memo-1", user_id: userId, content: "集合速记 #主题", tags: ["主题"],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  mockDb.import_tasks ??= [];
  mockDb.import_files ??= [];
  mockDb.import_files.push({
    id: "col-file-1", task_id: "col-task-1", user_id: userId,
    file_name: "集合文件.pdf", mime: "application/pdf", size: 10, kind: "pdf",
    status: "saved", error: null, reading_item_id: null, page_count: null,
    retry_key: "col-1", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
});

const makeCollection = async (name: string): Promise<string> => {
  const { body } = await call("/api/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return body.collection.id as string;
};

describe("mock api shim: /api/collections", () => {
  it("创建/重命名/删除：删除集合来源保留", async () => {
    const id = await makeCollection("产品发布");
    const list = await call("/api/collections");
    expect(list.body.collections).toHaveLength(1);
    expect(list.body.collections[0]).toMatchObject({ name: "产品发布", itemCount: 0 });

    const renamed = await call(`/api/collections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "发布会材料" }),
    });
    expect(renamed.body.success).toBe(true);

    // 挂一条来源再删除集合 → 引用行消失、来源仍在
    await call(`/api/collections/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "reading", ids: ["col-reading-1"] }),
    });
    const del = await call(`/api/collections/${id}`, { method: "DELETE" });
    expect(del.body.success).toBe(true);
    const { mockDb } = await import("@/lib/supabase/mock-data");
    expect(mockDb.collections).toHaveLength(0);
    expect(mockDb.collection_items).toHaveLength(0);
    expect(mockDb.reading_items.find((r: any) => r.id === "col-reading-1")).toBeTruthy();
  });

  it("三源加入 + 幂等 + 计数；来源软删 → available=false（行不隐藏）", async () => {
    const id = await makeCollection("主题集");
    const add = await call(`/api/collections/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType: "reading",
        ids: ["col-reading-1", "col-reading-1"], // 重复 id 同批去重
      }),
    });
    expect(add.body.added).toBe(1);

    await call(`/api/collections/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "memo", ids: ["col-memo-1"] }),
    });
    await call(`/api/collections/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "file", ids: ["col-file-1"] }),
    });

    const page = await call(`/api/collections/${id}/items?limit=50`);
    expect(page.body.items).toHaveLength(3);
    expect(page.body.nextCursor).toBeNull();
    const types = page.body.items.map((i: any) => i.sourceType).sort();
    expect(types).toEqual(["file", "memo", "reading"]);
    expect(page.body.items.every((i: any) => i.available)).toBe(true);

    // 软删速记（mock 语义 = deleted_at 标记）→ available=false，行保留
    const { mockDb } = await import("@/lib/supabase/mock-data");
    mockDb.memos.find((m: any) => m.id === "col-memo-1").deleted_at = new Date().toISOString();
    const after = await call(`/api/collections/${id}/items`);
    const memoRow = after.body.items.find((i: any) => i.sourceType === "memo");
    expect(memoRow.available).toBe(false);

    // 不存在的来源 → 400 明确报错（对应真实 FK 23503）
    const bad = await call(`/api/collections/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "reading", ids: ["no-such-item"] }),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("不存在");
  });

  it("游标分页：limit 2 翻两页不重不漏；空名 400", async () => {
    // 造 3 个阅读来源挂进同一集合
    const { mockDb } = await import("@/lib/supabase/mock-data");
    for (let i = 0; i < 3; i++) {
      mockDb.reading_items.push({
        id: `page-reading-${i}`, user_id: userId, url: `https://example.com/${i}`,
        title: `分页文章${i}`, excerpt: null, content: null,
        reading_status: "unread", reading_progress: 0, is_pinned: false,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
        updated_at: new Date().toISOString(), tags: [],
      });
    }
    const id = await makeCollection("分页集");
    await call(`/api/collections/${id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType: "reading",
        ids: ["page-reading-0", "page-reading-1", "page-reading-2"],
      }),
    });

    const p1 = await call(`/api/collections/${id}/items?limit=2`);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await call(
      `/api/collections/${id}/items?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
    );
    const seen = new Set([...p1.body.items, ...p2.body.items].map((i: any) => i.sourceId));
    expect(seen.size).toBe(3);

    const badName = await call("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(badName.status).toBe(400);
  });
});
