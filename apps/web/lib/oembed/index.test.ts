import { describe, expect, it } from "vitest";
import { parseLinkCard } from "./index";

describe("parseLinkCard", () => {
  it("从 OG 标签提取标题/描述/封面/站点名", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="测试文章标题">
        <meta property="og:description" content="文章摘要">
        <meta property="og:image" content="https://example.com/cover.jpg">
        <meta property="og:site_name" content="示例站">
      </head><body></body></html>`;
    const card = parseLinkCard(html, new URL("https://example.com/post/1"));
    expect(card.title).toBe("测试文章标题");
    expect(card.description).toBe("文章摘要");
    expect(card.cover).toBe("https://example.com/cover.jpg");
    expect(card.siteName).toBe("示例站");
  });

  it("缺 OG 标签时回退到 title 与域名", () => {
    const html = `<html><head><title>普通标题</title></head><body></body></html>`;
    const card = parseLinkCard(html, new URL("https://blog.example.org/x"));
    expect(card.title).toBe("普通标题");
    expect(card.siteName).toBe("blog.example.org");
    expect(card.cover).toBeNull();
    expect(card.description).toBeUndefined();
  });

  it("标题与站点名都缺时用 hostname 兜底", () => {
    const card = parseLinkCard("<html></html>", new URL("https://noname.io/"));
    expect(card.title).toBe("noname.io");
    expect(card.siteName).toBe("noname.io");
  });
});
