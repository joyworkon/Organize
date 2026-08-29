import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeResult } from "@organize/shared";

// collectReadingItem 是稍后读收集的唯一入口；本文件用「固定抓取响应 + stub 客户端」
// 冻结它的对外语义：字段映射、失败降级、去重、事件、错误不假成功。
const scrapeMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/scraper/client", () => ({ scrapeUrl: scrapeMock }));
vi.mock("@/lib/supabase/client", () => ({ createClient: createClientMock }));

import { appEvents } from "@/lib/plugin/events";
import { collectReadingItem, collectResultToast } from "@/lib/reading/collect";

const USER = { id: "user-1" };

/** 固定抓取响应：site_name/author/published_time 无对应列，服务必须丢弃 */
const FIXED_SCRAPE: ScrapeResult = {
  url: "https://a.com/post",
  title: "固定标题",
  content: "<p>固定正文</p>",
  excerpt: "固定摘要",
  cover_image: "https://img.example.com/cover.jpg",
  site_name: "a.com",
  author: "某人",
  published_time: "2026-01-01T00:00:00Z",
};

interface StubRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  url: string;
  title?: string | null;
  deleted_at?: string | null;
}

interface StubOptions {
  user?: { id: string } | null;
  rows?: StubRow[];
  queryError?: { message: string } | null;
  insertError?: { message: string } | null;
}

/** supabase-js 查询构造器的最小 stub：覆盖 collect.ts 用到的链路 */
function createStubClient(opts: StubOptions = {}) {
  const rows = opts.rows ?? [];
  const insertedPayloads: Record<string, unknown>[] = [];
  const eqFilters: Array<[string, unknown]> = [];
  let isFilter: Array<[string, unknown]> = [];

  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.user === undefined ? USER : opts.user }, error: null }),
    },
    from: (table: string) => {
      if (table !== "reading_items") throw new Error(`unexpected table: ${table}`);
      let op: "select" | "insert" = "select";
      let payload: Record<string, unknown> | null = null;
      const builder = {
        select: () => builder,
        insert: (p: Record<string, unknown>) => {
          op = "insert";
          payload = p;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          eqFilters.push([column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          isFilter.push([column, value]);
          return builder;
        },
        limit: () => builder,
        single: () => builder,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve().then(() => {
            if (op === "insert") {
              if (opts.insertError) {
                resolve({ data: null, error: opts.insertError });
                return;
              }
              insertedPayloads.push(payload!);
              resolve({ data: { id: "new-item-1", ...payload }, error: null });
              return;
            }
            if (opts.queryError) {
              resolve({ data: null, error: opts.queryError });
              return;
            }
            const matched = rows.filter((row) =>
              eqFilters.every(([c, v]) => row[c] === v) &&
              isFilter.every(([c, v]) => (v === null ? row[c] == null : row[c] === v))
            );
            resolve({ data: matched.slice(0, 1), error: null });
          }),
      } as unknown as Record<string, unknown> & PromiseLike<unknown>;
      return builder;
    },
  };
  return { client, insertedPayloads, eqFilters };
}

function registerEventSpy() {
  const events: Array<{ itemId: string; url: string; title: string }> = [];
  const off = appEvents.on("reading:item-created", (payload) => events.push(payload));
  return { events, off };
}

beforeEach(() => {
  scrapeMock.mockReset();
  createClientMock.mockReset();
});

describe("collectReadingItem 保存语义", () => {
  it("固定抓取响应 → 插入字段与冻结映射完全一致并发事件", async () => {
    scrapeMock.mockResolvedValue(FIXED_SCRAPE);
    const { client, insertedPayloads } = createStubClient();
    createClientMock.mockReturnValue(client);
    const { events, off } = registerEventSpy();

    const result = await collectReadingItem("https://a.com/post");
    off();

    expect(result.status).toBe("saved");
    expect(result.itemId).toBe("new-item-1");
    expect(result.url).toBe("https://a.com/post");
    expect(result.title).toBe("固定标题");

    expect(insertedPayloads).toHaveLength(1);
    // 字段清单冻结：恰好这 8 个字段（site_name/author/published_time 无列不入库）
    expect(Object.keys(insertedPayloads[0]).sort()).toEqual(
      ["content", "cover_image", "excerpt", "reading_progress", "reading_status", "title", "url", "user_id"].sort()
    );
    expect(insertedPayloads[0]).toEqual({
      user_id: "user-1",
      url: "https://a.com/post",
      title: "固定标题",
      content: "<p>固定正文</p>",
      excerpt: "固定摘要",
      cover_image: "https://img.example.com/cover.jpg",
      reading_status: "unread",
      reading_progress: 0,
    });
    expect(events).toEqual([
      { itemId: "new-item-1", url: "https://a.com/post", title: "固定标题" },
    ]);
  });

  it("粘贴文本带杂讯 → 先规范化提取 URL，再以规范化值抓取与入库", async () => {
    scrapeMock.mockResolvedValue(FIXED_SCRAPE);
    const { client, insertedPayloads, eqFilters } = createStubClient();
    createClientMock.mockReturnValue(client);

    const result = await collectReadingItem(" 看看这篇 https://a.com/post?q=1。值得读 ");
    expect(result.status).toBe("saved");
    expect(scrapeMock).toHaveBeenCalledWith("https://a.com/post?q=1");
    expect(eqFilters).toContainEqual(["url", "https://a.com/post?q=1"]);
    expect(insertedPayloads[0].url).toBe("https://a.com/post?q=1");
  });

  it("抓取失败 → 仅存链接降级（title=规范化 URL、正文字段 null），仍发事件", async () => {
    scrapeMock.mockRejectedValue(new Error("抓取失败"));
    const { client, insertedPayloads } = createStubClient();
    createClientMock.mockReturnValue(client);
    const { events, off } = registerEventSpy();

    const result = await collectReadingItem("https://a.com/post");
    off();

    expect(result.status).toBe("saved-link-only");
    expect(result.title).toBe("https://a.com/post");
    expect(insertedPayloads[0]).toEqual({
      user_id: "user-1",
      url: "https://a.com/post",
      title: "https://a.com/post",
      content: null,
      excerpt: null,
      cover_image: null,
      reading_status: "unread",
      reading_progress: 0,
    });
    expect(events).toHaveLength(1);
  });
});

describe("collectReadingItem 去重语义（限定 user_id）", () => {
  it("同用户同 URL 活跃条目 → duplicate：不抓取、不插入、不发事件", async () => {
    const { client, insertedPayloads } = createStubClient({
      rows: [{ id: "item-x", user_id: "user-1", url: "https://a.com/post", title: "已有条目", deleted_at: null }],
    });
    createClientMock.mockReturnValue(client);
    const { events, off } = registerEventSpy();

    const result = await collectReadingItem("https://a.com/post");
    off();

    expect(result).toEqual({
      status: "duplicate",
      itemId: "item-x",
      url: "https://a.com/post",
      title: "已有条目",
    });
    expect(scrapeMock).not.toHaveBeenCalled();
    expect(insertedPayloads).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("去重查询显式限定 user_id：他人的同 URL 行不会命中", async () => {
    scrapeMock.mockResolvedValue(FIXED_SCRAPE);
    const { client, insertedPayloads, eqFilters } = createStubClient({
      rows: [{ id: "item-other", user_id: "user-2", url: "https://a.com/post", title: "别人的条目" }],
    });
    createClientMock.mockReturnValue(client);

    const result = await collectReadingItem("https://a.com/post");

    expect(eqFilters).toContainEqual(["user_id", "user-1"]);
    expect(result.status).toBe("saved");
    expect(insertedPayloads).toHaveLength(1);
  });

  it("软删除行被排除（deleted_at is null）：再次保存产生新条目，回收站副本不动", async () => {
    scrapeMock.mockResolvedValue(FIXED_SCRAPE);
    const { client, insertedPayloads } = createStubClient({
      rows: [{ id: "item-trash", user_id: "user-1", url: "https://a.com/post", title: "在垃圾箱", deleted_at: "2026-08-01T00:00:00Z" }],
    });
    createClientMock.mockReturnValue(client);

    const result = await collectReadingItem("https://a.com/post");

    expect(result.status).toBe("saved");
    expect(result.itemId).toBe("new-item-1");
    expect(insertedPayloads).toHaveLength(1);
  });
});

describe("collectReadingItem 失败不假成功", () => {
  it("没有有效 URL → invalid-url，不触达客户端与抓取", async () => {
    const { client } = createStubClient();
    createClientMock.mockReturnValue(client);

    const result = await collectReadingItem("这不是链接");

    expect(result.status).toBe("error");
    expect(result.errorReason).toBe("invalid-url");
    expect(scrapeMock).not.toHaveBeenCalled();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("未登录 → unauthenticated，不抓取不插入", async () => {
    const { client, insertedPayloads } = createStubClient({ user: null });
    createClientMock.mockReturnValue(client);

    const result = await collectReadingItem("https://a.com/post");

    expect(result.status).toBe("error");
    expect(result.errorReason).toBe("unauthenticated");
    expect(scrapeMock).not.toHaveBeenCalled();
    expect(insertedPayloads).toHaveLength(0);
  });

  it("去重查询失败 → fail-closed 报错，不尝试插入", async () => {
    const { client, insertedPayloads } = createStubClient({
      queryError: { message: "network down" },
    });
    createClientMock.mockReturnValue(client);

    const result = await collectReadingItem("https://a.com/post");

    expect(result.status).toBe("error");
    expect(result.errorReason).toBe("save-failed");
    expect(result.message).toBe("network down");
    expect(scrapeMock).not.toHaveBeenCalled();
    expect(insertedPayloads).toHaveLength(0);
  });

  it("插入失败 → 携带原始错误消息，不发事件", async () => {
    scrapeMock.mockResolvedValue(FIXED_SCRAPE);
    const { client } = createStubClient({ insertError: { message: "permission denied" } });
    createClientMock.mockReturnValue(client);
    const { events, off } = registerEventSpy();

    const result = await collectReadingItem("https://a.com/post");
    off();

    expect(result.status).toBe("error");
    expect(result.errorReason).toBe("save-failed");
    expect(result.message).toBe("permission denied");
    expect(events).toHaveLength(0);
  });
});

describe("collectResultToast 统一文案", () => {
  it("成功/降级/重复/错误各有一档，错误必须 destructive", async () => {
    expect(collectResultToast({ status: "saved", itemId: "1", url: "u", title: "t" })).toEqual({
      title: "已保存到稍后读",
    });
    expect(
      collectResultToast({ status: "saved-link-only", itemId: "1", url: "u", title: "u" })
    ).toEqual({ title: "已保存（正文抓取失败，仅存链接）" });
    expect(collectResultToast({ status: "duplicate", itemId: "1", url: "u", title: "t" })).toEqual({
      title: "该链接已在稍后读中",
    });
    expect(
      collectResultToast({
        status: "error",
        itemId: null,
        url: null,
        title: null,
        errorReason: "save-failed",
        message: "permission denied",
      })
    ).toEqual({ title: "permission denied", variant: "destructive" });
    expect(
      collectResultToast({
        status: "error",
        itemId: null,
        url: null,
        title: null,
        errorReason: "invalid-url",
      })
    ).toEqual({ title: "添加失败，请重试", variant: "destructive" });
  });
});
