import { describe, expect, it } from "vitest";
import { resolveTriggerDeleteRange } from "./slash-trigger";

describe("resolveTriggerDeleteRange（斜杠命令触发符删除范围）", () => {
  it("优先精确删除 suggestion 给出的 range，保留块内已有文字", () => {
    // 段落内容 "/已有文字"：range 只覆盖 "/"，不得删到块尾
    const result = resolveTriggerDeleteRange({
      range: { from: 11, to: 12 },
      blockPos: 10,
      blockNodeSize: 8,
      blockText: "/已有文字",
    });
    expect(result).toEqual({ from: 11, to: 12 });
  });

  it("无 range 且整块只有 / 时才删除整块内容", () => {
    const result = resolveTriggerDeleteRange({
      range: null,
      blockPos: 10,
      blockNodeSize: 3,
      blockText: "/",
    });
    expect(result).toEqual({ from: 11, to: 12 });
  });

  it("无 range 但块内有其他文字时不删除任何内容", () => {
    const result = resolveTriggerDeleteRange({
      blockPos: 10,
      blockNodeSize: 8,
      blockText: "/已有文字",
    });
    expect(result).toBeNull();
  });

  it("range 非法（to < from）时走兜底逻辑", () => {
    const result = resolveTriggerDeleteRange({
      range: { from: 12, to: 11 },
      blockPos: 10,
      blockNodeSize: 3,
      blockText: "/",
    });
    expect(result).toEqual({ from: 11, to: 12 });
  });
});
