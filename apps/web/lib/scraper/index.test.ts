import { describe, expect, it, vi } from "vitest";
import { scrapeUrl } from "./index";
import type { HttpRequester } from "./safe-fetch";
import type { AddressLookup } from "./url-safety";

const lookup: AddressLookup = async () => [
  { address: "93.184.216.34", family: 4 },
];

function fixtureRequest(html: string): HttpRequester {
  return vi.fn<HttpRequester>(async () => ({
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: html,
  }));
}

describe("scrapeUrl platform extraction", () => {
  it("keeps WeChat lazy-loaded images and normalizes their URLs", async () => {
    const result = await scrapeUrl("https://mp.weixin.qq.com/s/example", {
      lookup,
      request: fixtureRequest(`
        <html>
          <head><meta property="og:image" content="//cdn.example/cover.jpg"></head>
          <body>
            <div id="activity-name">示例文章</div>
            <div id="js_content">
              <img data-src="//cdn.example/article.jpg" alt="图一">
              <p>正文</p>
            </div>
          </body>
        </html>
      `),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.content).toContain('src="https://cdn.example/article.jpg"');
    expect(result.data?.content).toContain('referrerpolicy="no-referrer"');
    expect(result.data?.cover_image).toBe("https://cdn.example/cover.jpg");
  });

  it("turns a YouTube video description into readable content", async () => {
    const result = await scrapeUrl("https://www.youtube.com/watch?v=abc123xyz01", {
      lookup,
      request: fixtureRequest(`
        <html>
          <head>
            <meta property="og:title" content="示例视频">
            <meta property="og:description" content="视频简介 &amp; 章节">
            <meta property="og:image" content="//i.ytimg.com/vi/abc123xyz01/maxresdefault.jpg">
          </head>
          <body></body>
        </html>
      `),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.title).toBe("示例视频");
    expect(result.data?.content).toContain("视频简介");
    expect(result.data?.content).toContain(
      'src="https://i.ytimg.com/vi/abc123xyz01/maxresdefault.jpg"'
    );
    expect(result.data?.cover_image).toBe(
      "https://i.ytimg.com/vi/abc123xyz01/maxresdefault.jpg"
    );
  });

  it("extracts Xiaohongshu text and images from SSR state", async () => {
    const state = {
      note: {
        noteDetailMap: {
          abc123: {
            note: {
              title: "小红书示例",
              desc: "第一段\n第二段",
              imageList: [
                { urlDefault: "//cdn.example/one.jpg" },
                { urlDefault: "http://sns-webpic-qc.xhscdn.com/two.jpg" },
              ],
              user: { nickName: "示例作者" },
              time: "2026-08-03",
            },
          },
        },
      },
    };
    const result = await scrapeUrl(
      "https://www.xiaohongshu.com/explore/abc123",
      {
        lookup,
        request: fixtureRequest(
          `<html><head></head><body><script>window.__INITIAL_STATE__ = ${JSON.stringify(state)}</script></body></html>`
        ),
      }
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.title).toBe("小红书示例");
    expect(result.data?.author).toBe("示例作者");
    expect(result.data?.content).toContain('src="https://cdn.example/one.jpg"');
    expect(result.data?.content).toContain(
      'src="https://sns-webpic-qc.xhscdn.com/two.jpg"'
    );
  });

  it("rejects a Xiaohongshu error page instead of saving it as an article", async () => {
    const result = await scrapeUrl(
      "https://www.xiaohongshu.com/explore/missing-note",
      {
        lookup,
        request: fixtureRequest(`
          <html>
            <head>
              <title>小红书 - 你访问的页面不见了</title>
              <meta name="description" content="当前笔记暂时无法浏览">
            </head>
            <body><main><p>返回首页</p></main></body>
          </html>
        `),
      }
    );

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("PARSE_FAILED");
  });

  it("adds X post media to the readable body but ignores profile pictures", async () => {
    const mediaResult = await scrapeUrl("https://x.com/example/status/123", {
      lookup,
      request: fixtureRequest(`
        <html>
          <head>
            <meta property="og:title" content="示例帖子">
            <meta property="og:description" content="帖子正文">
            <meta property="og:image" content="https://pbs.twimg.com/media/example.jpg">
          </head>
          <body></body>
        </html>
      `),
    });
    const profileResult = await scrapeUrl("https://x.com/example/status/456", {
      lookup,
      request: fixtureRequest(`
        <html>
          <head>
            <meta property="og:title" content="纯文字帖子">
            <meta property="og:description" content="只有文字">
            <meta property="og:image" content="https://pbs.twimg.com/profile_images/example.jpg">
          </head>
          <body></body>
        </html>
      `),
    });

    expect(mediaResult.data?.content).toContain(
      'src="https://pbs.twimg.com/media/example.jpg"'
    );
    expect(profileResult.data?.content).not.toContain("profile_images");
  });
});
