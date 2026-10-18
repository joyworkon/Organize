import { describe, expect, it } from "vitest";

import {
  TRANSFER_CANDIDATE_NAMES_LOAD_ERROR_MESSAGE,
  nextTransferCandidateNamesAfterLoad,
} from "./transfer-candidate-names-load";

describe("nextTransferCandidateNamesAfterLoad", () => {
  it("成功有名：按 userIds 顺序组装候选，无错误", () => {
    const result = nextTransferCandidateNamesAfterLoad({
      userIds: ["u-1", "u-2"],
      nameById: new Map([
        ["u-2", "李四"],
        ["u-1", "张三"],
      ]),
      error: null,
    });
    expect(result.candidates).toEqual([
      { user_id: "u-1", name: "张三" },
      { user_id: "u-2", name: "李四" },
    ]);
    expect(result.loadError).toBeNull();
  });

  it("成功但个别查不到名字 / display_name 为 null：name null（真·缺名），不算失败", () => {
    const result = nextTransferCandidateNamesAfterLoad({
      userIds: ["u-1", "u-missing", "u-null"],
      nameById: new Map<string, string | null>([
        ["u-1", "张三"],
        ["u-null", null],
      ]),
      error: null,
    });
    expect(result.candidates).toEqual([
      { user_id: "u-1", name: "张三" },
      { user_id: "u-missing", name: null },
      { user_id: "u-null", name: null },
    ]);
    expect(result.loadError).toBeNull();
  });

  it("名称查询失败：仍组装 candidates（能取到的照取、取不到的 null）+ 错误文案，不清空候选列表", () => {
    const result = nextTransferCandidateNamesAfterLoad({
      userIds: ["u-1", "u-2"],
      nameById: new Map<string, string | null>([["u-1", "张三"]]),
      error: { message: "permission denied for table user_profiles" },
    });
    expect(result.candidates).toEqual([
      { user_id: "u-1", name: "张三" },
      { user_id: "u-2", name: null },
    ]);
    expect(result.loadError).toBe(TRANSFER_CANDIDATE_NAMES_LOAD_ERROR_MESSAGE);
  });

  it("名称查询失败且 userIds 为空：空 candidates + 错误文案", () => {
    const result = nextTransferCandidateNamesAfterLoad({
      userIds: [],
      nameById: new Map(),
      error: new Error("fetch failed"),
    });
    expect(result.candidates).toEqual([]);
    expect(result.loadError).toBe(TRANSFER_CANDIDATE_NAMES_LOAD_ERROR_MESSAGE);
  });

  it("nameById 也接受 Record 形状（与 Map 等价）", () => {
    const result = nextTransferCandidateNamesAfterLoad({
      userIds: ["u-1"],
      nameById: { "u-1": "张三" },
      error: null,
    });
    expect(result.candidates).toEqual([{ user_id: "u-1", name: "张三" }]);
    expect(result.loadError).toBeNull();
  });
});
