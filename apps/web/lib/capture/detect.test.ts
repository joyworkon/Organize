import { describe, expect, it } from "vitest";
import { detectCapture } from "./detect";

describe("detectCapture", () => {
  it("含链接识别为稍后读", () => {
    expect(detectCapture("看看 https://example.com/a").kind).toBe("url");
  });
  it("待办前缀识别为待办并去掉前缀", () => {
    expect(detectCapture("待办：写周报")).toEqual({ kind: "task", text: "写周报" });
    expect(detectCapture("todo: ship it")).toEqual({ kind: "task", text: "ship it" });
    expect(detectCapture("- [ ] 买牛奶")).toEqual({ kind: "task", text: "买牛奶" });
  });
  it("只有前缀不算待办；其余为速记", () => {
    expect(detectCapture("待办：").kind).toBe("memo");
    expect(detectCapture("一个想法 #灵感")).toEqual({ kind: "memo", text: "一个想法 #灵感" });
    expect(detectCapture("   ").text).toBe("");
  });
});
