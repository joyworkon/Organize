import { describe, expect, it } from "vitest";
import { isSlashTriggerText, resolveTriggerDeleteRange } from "./slash-trigger";

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

  it("行内筛选时 range 覆盖 \"/查询词\" 全段，同样精确删除并保留光标后的原文字", () => {
    // 段落内容 "/h2已有文字"：光标在 "2" 后，range = "/h2"
    const result = resolveTriggerDeleteRange({
      range: { from: 11, to: 14 },
      blockPos: 10,
      blockNodeSize: 10,
      blockText: "/h2已有文字",
    });
    expect(result).toEqual({ from: 11, to: 14 });
  });

  it("range 越出块内容区（前后任一侧）时不删任何内容", () => {
    const block = { blockPos: 10, blockNodeSize: 8, blockText: "/已有文字" };
    expect(resolveTriggerDeleteRange({ ...block, range: { from: 10, to: 12 } })).toBeNull();
    expect(resolveTriggerDeleteRange({ ...block, range: { from: 11, to: 18 } })).toBeNull();
    expect(resolveTriggerDeleteRange({ ...block, range: { from: 30, to: 32 } })).toBeNull();
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

describe("isSlashTriggerText（删除前最后一道校验）", () => {
  it("只接受以 / 开头且不含空白的触发文本", () => {
    expect(isSlashTriggerText("/")).toBe(true);
    expect(isSlashTriggerText("/h2")).toBe(true);
    expect(isSlashTriggerText("/待办")).toBe(true);
    expect(isSlashTriggerText("")).toBe(false);
    expect(isSlashTriggerText("已有文字")).toBe(false);
    expect(isSlashTriggerText("a/h2")).toBe(false);
    expect(isSlashTriggerText("/h2 已有")).toBe(false);
  });
});
