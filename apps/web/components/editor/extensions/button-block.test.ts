import { describe, expect, it } from "vitest";
import {
  isSafeButtonUrl,
  normalizeButtonAction,
  parseButtonBlocksPayload,
} from "./button-block";

describe("isSafeButtonUrl", () => {
  it("允许 http/https 与站内路径", () => {
    expect(isSafeButtonUrl("https://example.com")).toBe(true);
    expect(isSafeButtonUrl("http://example.com/a")).toBe(true);
    expect(isSafeButtonUrl("/notes/abc")).toBe(true);
  });
  it("阻止可执行/危险协议", () => {
    expect(isSafeButtonUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeButtonUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeButtonUrl("vbscript:foo")).toBe(false);
    expect(isSafeButtonUrl("")).toBe(false);
    expect(isSafeButtonUrl("   ")).toBe(false);
    expect(isSafeButtonUrl("not a url")).toBe(false);
  });
});

describe("normalizeButtonAction", () => {
  it("非法值回退 open-url", () => {
    expect(normalizeButtonAction("open-url")).toBe("open-url");
    expect(normalizeButtonAction("insert-blocks")).toBe("insert-blocks");
    expect(normalizeButtonAction("bad")).toBe("open-url");
    expect(normalizeButtonAction(undefined)).toBe("open-url");
  });
});

describe("parseButtonBlocksPayload", () => {
  it("解析合法块数组", () => {
    const payload = JSON.stringify([{ type: "paragraph", content: [] }]);
    const result = parseButtonBlocksPayload(payload);
    expect(result).toEqual([{ type: "paragraph", content: [] }]);
  });
  it("空/非法/非数组返回 null", () => {
    expect(parseButtonBlocksPayload("")).toBeNull();
    expect(parseButtonBlocksPayload("   ")).toBeNull();
    expect(parseButtonBlocksPayload("not json")).toBeNull();
    expect(parseButtonBlocksPayload("{}")).toBeNull();
    expect(parseButtonBlocksPayload("[]")).toBeNull();
  });
});
