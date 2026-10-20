// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  countVersionChanges,
  diffChangedKeys,
  emphasizeChangedBlock,
  nextChangedCursor,
  versionChangeLabel,
} from "./note-history-diff";

const block = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});

describe("diffChangedKeys / countVersionChanges", () => {
  const current = {
    type: "doc",
    content: [block("a", "相同"), block("b", "旧")],
  };

  it("相同块不计数，id 本身不参与比较", () => {
    expect(countVersionChanges({ type: "doc", content: [block("a", "相同"), block("b", "旧")] }, current)).toBe(0);
    expect(diffChangedKeys({ type: "doc", content: [block("a", "相同")] }, current).size).toBe(0);
  });

  it("版本侧改过或新增的顶层块计入 N，当前多出来的块不计入", () => {
    const version = {
      type: "doc",
      content: [block("a", "相同"), block("b", "新"), block("c", "多出来")],
    };
    const changed = diffChangedKeys(version, current);
    expect(changed).toEqual(new Set(["b", "c"]));
    expect(countVersionChanges(version, current)).toBe(2);
    // 只统计版本 HTML 里画得出来的块：当前多出来的块不计入
    const versionSame = { type: "doc", content: [block("a", "相同")] };
    const currentExtra = { type: "doc", content: [block("a", "相同"), block("z", "只在当前")] };
    expect(countVersionChanges(versionSame, currentExtra)).toBe(0);
  });

  it("没有 id 时用序号 key，与预览 DOM 的 #idx 回退一致", () => {
    const version = { content: [{ type: "paragraph", attrs: {}, text: "a" }] };
    const same = { content: [{ type: "paragraph", attrs: {}, text: "b" }] };
    expect(diffChangedKeys(version, same).has("#idx:0")).toBe(true);
  });

  it("空文档与非对象按 0 处处理", () => {
    expect(countVersionChanges(null, null)).toBe(0);
    expect(countVersionChanges("nope", current)).toBe(0);
  });
});

describe("versionChangeLabel", () => {
  it("0 处与有改动的文案", () => {
    expect(versionChangeLabel(0)).toBe("与当前内容相同");
    expect(versionChangeLabel(-1)).toBe("与当前内容相同");
    expect(versionChangeLabel(3)).toBe("与当前相比 3 处不同");
  });
});

describe("nextChangedCursor", () => {
  it("从尚未定位开始：下一处是第一处，上一处是最后一处", () => {
    expect(nextChangedCursor(-1, 1, 3)).toBe(0);
    expect(nextChangedCursor(-1, -1, 3)).toBe(2);
  });

  it("在范围内循环", () => {
    expect(nextChangedCursor(0, -1, 3)).toBe(2);
    expect(nextChangedCursor(2, 1, 3)).toBe(0);
    expect(nextChangedCursor(1, 1, 3)).toBe(2);
  });

  it("没有改动时停在 -1", () => {
    expect(nextChangedCursor(0, 1, 0)).toBe(-1);
  });
});

describe("emphasizeChangedBlock", () => {
  it("只强调目标块，并清掉上一处强调", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p class="nv-changed" id="a"></p><p id="b"></p><p class="nv-changed" id="c"></p>';
    const second = emphasizeChangedBlock(root, 1);
    expect(second?.id).toBe("c");
    expect(second?.classList.contains("nv-changed-focus")).toBe(true);
    const first = emphasizeChangedBlock(root, 0);
    expect(first?.id).toBe("a");
    expect(root.querySelectorAll(".nv-changed-focus")).toHaveLength(1);
    expect(emphasizeChangedBlock(root, 5)).toBeNull();
  });
});
