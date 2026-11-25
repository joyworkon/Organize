import { describe, expect, it } from "vitest";
import { prepareReadingContent } from "./reading-images";

describe("prepareReadingContent", () => {
  it("adds safe loading attributes to stored images", () => {
    const content = prepareReadingContent('<p>正文</p><img src="https://cdn.example/a.jpg">');

    expect(content).toContain('referrerpolicy="no-referrer"');
    expect(content).toContain('decoding="async"');
    expect(content).toContain('loading="lazy"');
  });

  it("replaces an old referrer policy and preserves explicit loading", () => {
    const content = prepareReadingContent(
      '<img src="https://cdn.example/a.jpg" referrerpolicy="origin" loading="eager">'
    );

    expect(content).toContain('referrerpolicy="no-referrer"');
    expect(content).not.toContain('referrerpolicy="origin"');
    expect(content.match(/referrerpolicy=/g)).toHaveLength(1);
    expect(content).toContain('loading="eager"');
  });

  // 入库内容不保证经过清洗（备份恢复、登录用户直插都绕过抓取），渲染前必须再清洗一道
  it("渲染前剥离脚本与事件属性", () => {
    const content = prepareReadingContent(
      '<p>正文</p><img src="https://cdn.example/a.jpg" onerror="alert(1)"><script>alert(1)</script>'
    );

    expect(content).toContain("<p>正文</p>");
    expect(content).toContain('src="https://cdn.example/a.jpg"');
    expect(content).not.toContain("onerror");
    expect(content).not.toContain("<script");
    expect(content).not.toContain("alert(1)");
  });

  it("渲染前丢弃 javascript: 链接，合法外链强制带 noopener", () => {
    const content = prepareReadingContent(
      '<a href="javascript:alert(1)">坏链接</a><a href="https://example.com/a">好链接</a>'
    );

    expect(content).not.toContain("javascript:");
    expect(content).toContain("坏链接");
    expect(content).toContain('href="https://example.com/a"');
    expect(content).toContain('rel="noopener noreferrer nofollow"');
  });

  it("渲染前保留内联 data 图片", () => {
    const content = prepareReadingContent('<img src="data:image/png;base64,abc">');

    expect(content).toContain('src="data:image/png;base64,abc"');
  });

  it("对已清洗内容幂等：重复准备不改变结果", () => {
    const once = prepareReadingContent(
      '<p>a &amp; b</p><img src="https://cdn.example/a.jpg" loading="eager">'
    );

    expect(prepareReadingContent(once)).toBe(once);
  });

  it("清洗后为空的内容返回空串", () => {
    expect(prepareReadingContent("")).toBe("");
    expect(prepareReadingContent("<script>alert(1)</script>")).toBe("");
  });
});
