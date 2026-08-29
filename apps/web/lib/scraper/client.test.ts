import { beforeEach, describe, expect, it, vi } from "vitest";

// scrapeUrl 客户端统一入口：mock 分支（样例文章生成）与真实分支（POST /api/scrape）。
// NEXT_PUBLIC_MOCK_BACKEND 在源码里是运行时读取，测试里按需设置后动态 import。
const importModule = async () => {
  vi.resetModules();
  return import("@/lib/scraper/client");
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_MOCK_BACKEND;
});

describe("scrapeUrl mock 分支", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MOCK_BACKEND = "true";
  });

  it("从 URL slug 生成标题：连字符转空格、首字母大写", async () => {
    const { scrapeUrl } = await importModule();
    const result = await scrapeUrl("https://www.nngroup.com/articles/ux-research-cheat-sheet");
    expect(result.title).toBe("Ux research cheat sheet");
    expect(result.url).toBe("https://www.nngroup.com/articles/ux-research-cheat-sheet");
    expect(result.site_name).toBe("www.nngroup.com");
  });

  it("样例正文与封面可渲染", async () => {
    const { scrapeUrl } = await importModule();
    const result = await scrapeUrl("https://example.com/a-post");
    expect(result.content).toContain("<p>");
    expect(result.excerpt.length).toBeGreaterThan(0);
    expect(result.cover_image).toContain("picsum.photos");
    expect(result.cover_image).toContain("example.com");
  });

  it("slug 清理：剥离扩展名、解码 URI 组件、空路径回退主机名", async () => {
    const { scrapeUrl } = await importModule();
    expect((await scrapeUrl("https://a.com/x/post.html")).title).toBe("Post");
    expect((await scrapeUrl("https://a.com/%E4%B8%AD%E6%96%87-%E6%A0%87%E9%A2%98")).title).toBe("中文 标题");
    expect((await scrapeUrl("https://example.com/")).title).toBe("example.com");
  });

  it("mock 分支不发起任何网络请求", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { scrapeUrl } = await importModule();
    await scrapeUrl("https://example.com/x");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("scrapeUrl 真实分支", () => {
  it("POST /api/scrape 并返回解析结果", async () => {
    const scrapeResult = {
      url: "https://a.com/post",
      title: "真实标题",
      content: "<p>正文</p>",
      excerpt: "摘要",
      cover_image: null,
      site_name: "a.com",
      author: null,
      published_time: null,
    };
    const fetchSpy = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(scrapeResult), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { scrapeUrl } = await importModule();
    const result = await scrapeUrl("https://a.com/post");
    expect(result).toEqual(scrapeResult);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/scrape");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ url: "https://a.com/post" });
  });

  it("抓取失败（非 2xx）抛错，由调用方降级为仅存链接", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 }))
    );
    const { scrapeUrl } = await importModule();
    await expect(scrapeUrl("https://a.com/post")).rejects.toThrow("抓取失败");
  });
});
