import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScrapeResult } from "@organize/shared";
import { collectForExtension, type ExtensionCollectInput } from "@/lib/extension/collect";

// collectForExtension 是浏览器扩展收集的服务端内核；与 lib/reading/collect.test.ts
// 同一套冻结口径：字段映射、失败降级、去重、错误不假成功，另覆盖媒体小节拼接。
const USER_ID = "user-1";

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

interface StubOptions {
  rows?: { id: string; title?: string | null }[];
  queryError?: { message: string } | null;
  insertError?: { message: string } | null;
  scrape?: { data: ScrapeResult | null; error: { message?: string } | null } | "throw";
}

type StubClient = SupabaseClient & { insertedPayloads: Record<string, unknown>[] };

/** supabase-js 查询构造器的最小 stub：覆盖 collect.ts 用到的链路 */
function createStubClient(opts: StubOptions = {}): StubClient {
  const rows = opts.rows ?? [];
  const insertedPayloads: Record<string, unknown>[] = [];
  const client = {
    insertedPayloads,
    from(table: string) {
      if (table !== "reading_items") throw new Error("unexpected table: " + table);
      const chain = {
        select() {
          return {
            eq() {
              return this;
            },
            is() {
              return this;
            },
            limit() {
              return Promise.resolve({ data: rows, error: opts.queryError ?? null });
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          return {
            select() {
              return {
                single() {
                  if (opts.insertError) {
                    return Promise.resolve({ data: null, error: opts.insertError });
                  }
                  insertedPayloads.push(payload);
                  return Promise.resolve({ data: { id: "new-item-1" }, error: null });
                },
              };
            },
          };
        },
      };
      return chain;
    },
  };
  return client as unknown as StubClient;
}

function createDeps(opts: StubOptions = {}) {
  const scrapeResult =
    opts.scrape === "throw" ? null : (opts.scrape ?? { data: FIXED_SCRAPE, error: null });
  const scrape =
    opts.scrape === "throw"
      ? vi.fn(async () => {
          throw new Error("network down");
        })
      : vi.fn(async () => scrapeResult ?? { data: FIXED_SCRAPE, error: null });
  const supabase = createStubClient(opts);
  return { supabase, scrapeUrl: scrape, client: supabase };
}

function collectInput(overrides: Partial<ExtensionCollectInput> = {}): ExtensionCollectInput {
  return { userId: USER_ID, rawUrl: "https://a.com/post", ...overrides };
}

describe("collectForExtension", () => {
  it("invalid-url：提取不到 http(s) URL 时不查询不插入", async () => {
    const deps = createDeps();
    const result = await collectForExtension(deps, collectInput({ rawUrl: "随便一句话" }));
    expect(result.status).toBe("error");
    expect(result.errorReason).toBe("invalid-url");
    expect(deps.scrapeUrl).not.toHaveBeenCalled();
    expect(deps.client.insertedPayloads).toHaveLength(0);
  });

  it("duplicate：命中活跃条目时不抓取、不插入", async () => {
    const deps = createDeps({ rows: [{ id: "existing-1", title: "已有条目" }] });
    const result = await collectForExtension(deps, collectInput());
    expect(result).toMatchObject({
      status: "duplicate",
      itemId: "existing-1",
      title: "已有条目",
    });
    expect(deps.scrapeUrl).not.toHaveBeenCalled();
    expect(deps.client.insertedPayloads).toHaveLength(0);
  });

  it("saved：抓取成功时按 8 字段插入，媒体小节追加在正文之后", async () => {
    const deps = createDeps({
      scrape: { data: FIXED_SCRAPE, error: null },
    });
    const result = await collectForExtension(
      deps,
      collectInput({
        pageTitle: "扩展页面标题（不应生效）",
        mediaLinks: [{ type: "video", url: "https://a.com/v.mp4", title: "演示视频" }],
      })
    );
    expect(result.status).toBe("saved");
    expect(deps.client.insertedPayloads).toHaveLength(1);
    const payload = deps.client.insertedPayloads[0];
    expect(payload).toMatchObject({
      user_id: USER_ID,
      url: "https://a.com/post",
      title: "固定标题",
      excerpt: "固定摘要",
      cover_image: "https://img.example.com/cover.jpg",
      reading_status: "unread",
      reading_progress: 0,
    });
    expect(String(payload.content)).toContain("<p>固定正文</p>");
    expect(String(payload.content)).toContain('data-organize-media="1"');
    expect(String(payload.content)).toContain("🎬");
  });

  it("saved-link-only：抓取失败且无媒体时 content 为 null，标题回退 pageTitle", async () => {
    const deps = createDeps({ scrape: { data: null, error: { message: "TIMEOUT" } } });
    const result = await collectForExtension(
      deps,
      collectInput({ pageTitle: "页面标题" })
    );
    expect(result.status).toBe("saved-link-only");
    expect(result.title).toBe("页面标题");
    const payload = deps.client.insertedPayloads[0];
    expect(payload.content).toBeNull();
    expect(payload.excerpt).toBeNull();
  });

  it("抓取失败但带媒体链接时 content 仅含「页面媒体」小节", async () => {
    const deps = createDeps({ scrape: "throw" });
    const result = await collectForExtension(
      deps,
      collectInput({
        mediaLinks: [{ type: "video", url: "https://youtube.com/watch?v=abc12345678" }],
      })
    );
    expect(result.status).toBe("saved-link-only");
    const content = String(deps.client.insertedPayloads[0].content);
    expect(content).toContain('data-organize-media="1"');
    expect(content).not.toContain("<p>固定正文</p>");
  });

  it("媒体链接经清洗：危险协议与重复项不入 content", async () => {
    const deps = createDeps();
    await collectForExtension(
      deps,
      collectInput({
        mediaLinks: [
          { type: "video", url: "javascript:alert(1)" },
          { type: "video", url: "https://a.com/v.mp4" },
          { type: "video", url: "https://a.com/v.mp4?dup=1" },
          { type: "video", url: "https://a.com/post" },
        ],
      })
    );
    const content = String(deps.client.insertedPayloads[0].content);
    expect(content).not.toContain("javascript:");
    // 同一 URL 去重后链接只出现一次（query 不同视为不同资源，保留）
    expect(content.match(/<a href="https:\/\/a\.com\/v\.mp4"/g)).toHaveLength(1);
    expect(content).toContain("v.mp4?dup=1");
    expect(content).not.toContain('href="https://a.com/post"');
  });

  it("去重查询或插入失败 → error save-failed，不假成功", async () => {
    const queryFailed = createDeps({ queryError: { message: "db down" } });
    const q = await collectForExtension(queryFailed, collectInput());
    expect(q.status).toBe("error");
    expect(q.errorReason).toBe("save-failed");

    const insertFailed = createDeps({
      insertError: { message: "permission denied" },
    });
    const i = await collectForExtension(insertFailed, collectInput());
    expect(i.status).toBe("error");
    expect(i.errorReason).toBe("save-failed");
    expect(i.message).toContain("permission denied");
  });
});
