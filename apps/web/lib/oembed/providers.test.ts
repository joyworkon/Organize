import { describe, expect, it } from "vitest";
import { matchProvider, PROVIDER_IDS } from "./providers";

describe("matchProvider", () => {
  it("YouTube 各种 URL 形态", () => {
    expect(matchProvider("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.provider).toBe("YouTube");
    expect(matchProvider("https://youtu.be/dQw4w9WgXcQ")?.provider).toBe("YouTube");
    expect(matchProvider("https://www.youtube.com/embed/dQw4w9WgXcQ")?.provider).toBe("YouTube");
    expect(matchProvider("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.provider).toBe("YouTube");
  });
  it("YouTube html 包含 nocookie embed 与视频 id", () => {
    const r = matchProvider("https://youtu.be/dQw4w9WgXcQ");
    expect(r?.html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });
  it("Bilibili BV/av", () => {
    const r = matchProvider("https://www.bilibili.com/video/BV1xx411c7mD");
    expect(r?.provider).toBe("Bilibili");
    expect(r?.html).toContain("bvid=BV1xx411c7mD");
  });
  it("Vimeo", () => {
    const r = matchProvider("https://vimeo.com/76979871");
    expect(r?.provider).toBe("Vimeo");
    expect(r?.html).toContain("player.vimeo.com/video/76979871");
  });
  it("Twitter / X", () => {
    const r = matchProvider("https://twitter.com/elonmusk/status/1234567890");
    expect(r?.provider).toBe("Twitter / X");
  });
  it("GitHub Gist", () => {
    const r = matchProvider("https://gist.github.com/octocat/abc123");
    expect(r?.provider).toBe("GitHub Gist");
  });
  it("拒绝非 http/https 与无效 URL", () => {
    expect(matchProvider("javascript:alert(1)")).toBeNull();
    expect(matchProvider("not a url")).toBeNull();
    expect(matchProvider("ftp://example.com/file")).toBeNull();
  });
  it("未命中 provider 的普通站点返回 null（交由 OG 抓取回退）", () => {
    expect(matchProvider("https://example.com/some-article")).toBeNull();
    expect(matchProvider("https://random-blog.org/post")).toBeNull();
  });
  it("YouTube 但无法解析出视频 id 时返回 null", () => {
    expect(matchProvider("https://www.youtube.com/feed/subscriptions")).toBeNull();
  });
  it("PROVIDER_IDS 含全部内置 provider", () => {
    expect(PROVIDER_IDS).toContain("youtube");
    expect(PROVIDER_IDS).toContain("bilibili");
    expect(PROVIDER_IDS.length).toBeGreaterThanOrEqual(5);
  });
});
