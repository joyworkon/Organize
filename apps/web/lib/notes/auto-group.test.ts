import { describe, expect, it } from "vitest";
import { expandGroupName, parseJsonFromModel, proposeGroupsLocally, sanitizeAiProposals, type AutoGroupNote } from "./auto-group";

const note = (id: string, title: string, text = "", tags: string[] = []): AutoGroupNote => ({ id, title, text, tags });

describe("proposeGroupsLocally", () => {
  it("同一标签下 ≥2 篇成组，且以标签名命名", () => {
    const groups = proposeGroupsLocally([
      note("a", "周一会议", "", ["工作"]),
      note("b", "周报", "", ["工作"]),
      note("c", "随想", "", ["生活"]),
    ]);
    expect(groups[0]).toMatchObject({ name: "工作", noteIds: ["a", "b"], reason: "标签" });
    expect(groups.some((g) => g.noteIds.includes("c"))).toBe(false);
  });

  it("按标题关键词聚类，组名扩展为公共片段", () => {
    const groups = proposeGroupsLocally([
      note("1", "读《思考快与慢》的笔记", "系统一和系统二"),
      note("2", "读《原则》的笔记", "极度透明"),
      note("3", "React 性能优化", "useMemo 和 memo 的取舍"),
      note("4", "React 状态管理", "zustand 与 context"),
      note("5", "周末菜谱", "红烧肉"),
    ]);
    const names = groups.map((g) => g.name);
    expect(names).toContain("React");
    const react = groups.find((g) => g.name === "React")!;
    expect(react.noteIds.sort()).toEqual(["3", "4"]);
    const reading = groups.find((g) => g.noteIds.includes("1"));
    expect(reading?.noteIds.sort()).toEqual(["1", "2"]);
    expect(groups.some((g) => g.noteIds.includes("5"))).toBe(false);
  });

  it("每篇笔记至多进入一个建议组；笔记太少不分组", () => {
    const groups = proposeGroupsLocally([
      note("1", "产品设计评审", "", ["产品"]),
      note("2", "产品设计复盘", "", ["产品"]),
      note("3", "产品设计原则"),
    ]);
    const all = groups.flatMap((g) => g.noteIds);
    expect(new Set(all).size).toBe(all.length);
    expect(proposeGroupsLocally([note("x", "孤零零")])).toEqual([]);
  });
});

describe("expandGroupName", () => {
  it("向两侧扩展到组内多数成员共有的片段", () => {
    expect(expandGroupName("阅读", ["阅读方法论第一篇", "阅读方法论第二篇", "阅读方法论第三篇"])).toBe("阅读方法论");
  });
});

describe("sanitizeAiProposals / parseJsonFromModel", () => {
  it("只保留已知 id，每篇只进第一个组，丢弃空组", () => {
    const parsed = parseJsonFromModel('好的：\n```json\n{"groups":[{"name":"读书","noteIds":["a","b","zzz"]},{"name":"重复","noteIds":["a"]},{"name":"工作","noteIds":["c"]}]}\n```');
    const groups = sanitizeAiProposals(parsed, new Set(["a", "b", "c"]));
    expect(groups.map((g) => [g.name, g.noteIds])).toEqual([
      ["读书", ["a", "b"]],
      ["工作", ["c"]],
    ]);
  });
});
