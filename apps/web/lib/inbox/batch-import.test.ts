import { describe, expect, it } from "vitest";
import { extractFirstUrl, parseBatchUrls } from "./batch-import";

describe("parseBatchUrls", () => {
  it("extracts a Xiaohongshu URL from copied share text", () => {
    expect(
      extractFirstUrl(
        "12 示例作者发布了一篇小红书笔记，快来看吧！ https://xhslink.com/o/example，复制本条信息"
      )
    ).toBe("https://xhslink.com/o/example");
  });

  it("accepts mixed plain domains and full URLs without duplicates", () => {
    expect(
      parseBatchUrls(
        "example.com/a\nhttps://x.com/user/status/1 https://x.com/user/status/1"
      )
    ).toEqual(["https://example.com/a", "https://x.com/user/status/1"]);
  });
});
