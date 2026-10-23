import { describe, expect, it } from "vitest";
import {
  appendMediaSection,
  buildMediaSectionHtml,
  detectDirectMedia,
  extractMediaUrlsFromContent,
  normalizeMediaLinks,
  resolveMediaPreview,
} from "@/lib/extension/media";

describe("detectDirectMedia", () => {
  it("按扩展名识别直链视频与音频（含 query、大小写）", () => {
    expect(detectDirectMedia("https://cdn.example.com/a.mp4")).toBe("video");
    expect(detectDirectMedia("https://cdn.example.com/b.WEBM?token=1")).toBe("video");
    expect(detectDirectMedia("https://cdn.example.com/c.mp3")).toBe("audio");
    expect(detectDirectMedia("https://cdn.example.com/d.FLAC")).toBe("audio");
  });

  it("非 http(s)、无法解析、非媒体后缀返回 null", () => {
    expect(detectDirectMedia("chrome-extension://abc/x.mp4")).toBeNull();
    expect(detectDirectMedia("not a url")).toBeNull();
    expect(detectDirectMedia("https://example.com/page.html")).toBeNull();
    // .ogg 同时在视频/音频容器出现，按音频优先判定
    expect(detectDirectMedia("https://example.com/a.ogg")).toBe("audio");
  });
});

describe("resolveMediaPreview", () => {
  it("平台视频走 oEmbed 白名单（embed）", () => {
    const yt = resolveMediaPreview("https://www.youtube.com/watch?v=abc12345678");
    expect(yt?.kind).toBe("embed");
    expect(yt?.provider).toBe("YouTube");
    expect(yt?.html).toContain("youtube-nocookie.com/embed/abc12345678");

    const bili = resolveMediaPreview("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(bili?.kind).toBe("embed");
    expect(bili?.provider).toBe("Bilibili");
    expect(bili?.html).toContain("player.bilibili.com");

    const vimeo = resolveMediaPreview("https://vimeo.com/123456789");
    expect(vimeo?.kind).toBe("embed");
  });

  it("直链媒体返回原生播放类型，普通文章返回 null", () => {
    expect(resolveMediaPreview("https://cdn.example.com/movie.mp4")?.kind).toBe("video");
    expect(resolveMediaPreview("https://cdn.example.com/song.mp3")?.kind).toBe("audio");
    expect(resolveMediaPreview("https://example.com/article")).toBeNull();
  });
});

describe("extractMediaUrlsFromContent", () => {
  it("提取双引号与单引号 href，忽略无 href 的锚点", () => {
    const html = `<p><a href="https://a.com/v.mp4">视频</a></p><a href='https://b.com/x.mp3'>音频</a><a name="x"></a>`;
    expect(extractMediaUrlsFromContent(html)).toEqual([
      "https://a.com/v.mp4",
      "https://b.com/x.mp3",
    ]);
  });

  it("空内容返回空数组", () => {
    expect(extractMediaUrlsFromContent("")).toEqual([]);
    expect(extractMediaUrlsFromContent(null as unknown as string)).toEqual([]);
  });
});

describe("normalizeMediaLinks", () => {
  const PAGE = "https://page.com/post";

  it("过滤非 http(s) 与非法类型，保留可判定的直链与声明类型", () => {
    const out = normalizeMediaLinks(
      [
        { type: "video", url: "javascript:alert(1)" },
        { type: "subtitle", url: "https://a.com/x.srt" },
        { type: "video", url: "https://a.com/v.mp4" },
        { type: "audio", url: "https://a.com/embedded-player" },
      ],
      PAGE
    );
    expect(out).toEqual([
      { type: "video", url: "https://a.com/v.mp4", title: "" },
      { type: "audio", url: "https://a.com/embedded-player", title: "" },
    ]);
  });

  it("URL 判定优先于声明 type，按完整 URL 去重并剔除与主页面同路径的项", () => {
    const out = normalizeMediaLinks(
      [
        { type: "audio", url: "https://a.com/v.mp4" },
        { type: "video", url: "https://a.com/v.mp4" },
        { type: "video", url: "https://page.com/post" },
      ],
      PAGE
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: "video", url: "https://a.com/v.mp4", title: "" });
  });

  it("截断到上限 10 并截断超长标题", () => {
    const links = Array.from({ length: 15 }, (_, i) => ({
      type: "video",
      url: `https://a.com/v-${i}.mp4`,
    }));
    expect(normalizeMediaLinks(links, PAGE)).toHaveLength(10);
    const longTitle = normalizeMediaLinks(
      [{ type: "video", url: "https://a.com/v.mp4", title: "长".repeat(300) }],
      PAGE
    );
    expect(longTitle[0].title.length).toBe(200);
  });

  it("非数组输入返回空数组", () => {
    expect(normalizeMediaLinks(undefined, PAGE)).toEqual([]);
    expect(normalizeMediaLinks("x" as never, PAGE)).toEqual([]);
  });
});

describe("buildMediaSectionHtml / appendMediaSection", () => {
  it("空数组返回空串，不产生小节", () => {
    expect(buildMediaSectionHtml([])).toBe("");
    expect(appendMediaSection("<p>正文</p>", "")).toBe("<p>正文</p>");
  });

  it("生成带转义的链接小节，视频/音频图标区分", () => {
    const html = buildMediaSectionHtml([
      { type: "video", url: "https://a.com/v.mp4?a=1&b=2", title: '<script>alert(1)</script>' },
      { type: "audio", url: "https://a.com/a.mp3", title: "" },
    ]);
    expect(html).toContain('<h2 data-organize-media="1">页面媒体</h2>');
    expect(html).toContain('🎬 <a href="https://a.com/v.mp4?a=1&amp;b=2"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("🎧");
    expect(html).not.toContain("<script>");
  });

  it("追加到正文末尾；正文为空时仅含小节", () => {
    const section = buildMediaSectionHtml([
      { type: "video", url: "https://a.com/v.mp4", title: "" },
    ]);
    expect(appendMediaSection("<p>正文</p>", section)).toBe("<p>正文</p>\n" + section);
    expect(appendMediaSection("", section)).toBe(section);
  });
});
