import { describe, expect, it } from "vitest";
import { classifyCapture, CAPTURE_MEMO_MAX_LENGTH } from "./classify-capture";

describe("classifyCapture 统一输入分流", () => {
  it("空白与纯标点 → empty", () => {
    expect(classifyCapture("")).toEqual({ kind: "empty" });
    expect(classifyCapture("   \n\t ")).toEqual({ kind: "empty" });
    expect(classifyCapture("。。。")).toEqual({ kind: "memo", text: "。。。" });
  });

  it("整条 = 单 URL → url", () => {
    expect(classifyCapture("https://example.com/a")).toEqual({ kind: "url", url: "https://example.com/a" });
    // 剥尾部标点、允许首尾空白
    expect(classifyCapture("  https://example.com/a。")).toEqual({ kind: "url", url: "https://example.com/a" });
    expect(classifyCapture("http://sub.example.com/path?q=1")).toEqual({
      kind: "url",
      url: "http://sub.example.com/path?q=1",
    });
  });

  it("多个 URL 且剥离后只剩空白/换行/逗号 → urls（保序去重）", () => {
    expect(classifyCapture("https://a.com/1\nhttps://b.com/2")).toEqual({
      kind: "urls",
      urls: ["https://a.com/1", "https://b.com/2"],
    });
    expect(classifyCapture("https://a.com/1，https://a.com/1 https://b.com/2 ")).toEqual({
      kind: "urls",
      urls: ["https://a.com/1", "https://b.com/2"],
    });
  });

  it("文字夹带 URL → memo-with-urls（完整文字保留，不丢上下文）", () => {
    const text = "这篇文章 https://example.com/a 值得读，还有 https://b.com/b 也不错";
    expect(classifyCapture(text)).toEqual({
      kind: "memo-with-urls",
      text,
      urls: ["https://example.com/a", "https://b.com/b"],
    });
  });

  it("URL 前后只有括号和说明性空白仍算整条 URL", () => {
    expect(classifyCapture("（https://example.com/a）")).toEqual({ kind: "url", url: "https://example.com/a" });
  });

  it("无 URL 且 ≤5000 字 → memo", () => {
    expect(classifyCapture("一句想法 #标签")).toEqual({ kind: "memo", text: "一句想法 #标签" });
    const exactly = "字".repeat(CAPTURE_MEMO_MAX_LENGTH);
    expect(classifyCapture(exactly)).toEqual({ kind: "memo", text: exactly });
  });

  it("无 URL 且 >5000 字 → text-material（5000 边界 + 4 万内）", () => {
    const over = "字".repeat(CAPTURE_MEMO_MAX_LENGTH + 1);
    expect(classifyCapture(over)).toEqual({ kind: "text-material", text: over });
    const large = "字".repeat(40_000);
    expect(classifyCapture(large)).toEqual({ kind: "text-material", text: large });
  });

  it("含非 http 协议（ftp/mailto）不视为 URL → memo", () => {
    expect(classifyCapture("ftp://example.com/file")).toEqual({ kind: "memo", text: "ftp://example.com/file" });
  });
});
