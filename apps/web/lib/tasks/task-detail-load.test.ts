import { describe, it, expect } from "vitest";
import {
  failedTaskSecondarySections,
  taskSecondaryLoadErrorMessage,
} from "./task-detail-load";

/** 全部成功的查询结果形状（supabase-js 最小面） */
const ok = { data: [], error: null };
const failed = (message: string) => ({ data: null, error: { message } });

function sectionsWith(overrides: Partial<Record<"checklists" | "tagLinks" | "tags" | "attachments" | "activities", { error: unknown }>>) {
  return failedTaskSecondarySections({
    checklists: ok,
    tagLinks: ok,
    tags: ok,
    attachments: ok,
    activities: ok,
    ...overrides,
  });
}

describe("failedTaskSecondarySections", () => {
  it("全部成功：空列表（页面不渲染错误条）", () => {
    expect(sectionsWith({})).toEqual([]);
  });

  it("单个失败：返回对应区块名", () => {
    expect(sectionsWith({ checklists: failed("rls denied") })).toEqual(["子任务"]);
    expect(sectionsWith({ attachments: failed("500") })).toEqual(["附件"]);
    expect(sectionsWith({ activities: failed("network") })).toEqual(["动态"]);
  });

  it("task_tags 与 tags 同时失败：只出现一次「标签」（两查询共同决定标签区，去重）", () => {
    expect(
      sectionsWith({ tagLinks: failed("a"), tags: failed("b") })
    ).toEqual(["标签"]);
  });

  it("task_tags 与 tags 任一失败：都算「标签」", () => {
    expect(sectionsWith({ tagLinks: failed("a") })).toEqual(["标签"]);
    expect(sectionsWith({ tags: failed("b") })).toEqual(["标签"]);
  });

  it("多个失败：按 子任务→标签→附件→动态 固定顺序输出，与传入覆盖顺序无关", () => {
    expect(
      sectionsWith({
        activities: failed("network"),
        tagLinks: failed("rls"),
        checklists: failed("500"),
      })
    ).toEqual(["子任务", "标签", "动态"]);
    expect(
      sectionsWith({
        attachments: failed("x"),
        activities: failed("y"),
        tags: failed("z"),
        checklists: failed("w"),
      })
    ).toEqual(["子任务", "标签", "附件", "动态"]);
  });
});

describe("taskSecondaryLoadErrorMessage", () => {
  it("空列表（全部成功）：返回 null，调用方不渲染错误条", () => {
    expect(taskSecondaryLoadErrorMessage([])).toBeNull();
  });

  it("单个失败：文案含区块名与「显示的内容可能不完整」", () => {
    expect(taskSecondaryLoadErrorMessage(["附件"])).toBe(
      "附件加载失败，显示的内容可能不完整"
    );
  });

  it("多个失败：顿号拼接且顺序稳定（同一输入恒定输出）", () => {
    const message = taskSecondaryLoadErrorMessage(["子任务", "标签", "动态"]);
    expect(message).toBe("子任务、标签、动态加载失败，显示的内容可能不完整");
    expect(taskSecondaryLoadErrorMessage(["子任务", "标签", "动态"])).toBe(message);
  });
});
