import { describe, expect, it } from "vitest";

import {
  TRANSFER_CANDIDATES_LOAD_ERROR_MESSAGE,
  nextTransferCandidatesAfterLoad,
  type TransferCandidate,
} from "./transfer-candidates-load";

const member = (user_id: string, name: string | null = null): TransferCandidate => ({
  user_id,
  name,
});

describe("nextTransferCandidatesAfterLoad", () => {
  it("成功有数据：原样保持顺序返回，无错误", () => {
    const data = [member("u-1", "张三"), member("u-2")];
    const result = nextTransferCandidatesAfterLoad({ previous: [], data, error: null });
    expect(result.candidates).toEqual(data);
    expect(result.loadError).toBeNull();
  });

  it("成功且 data null / 空数组：空候选 + 无错误（真·空态，才可显示「还没有可移交的协作者」）", () => {
    expect(nextTransferCandidatesAfterLoad({ previous: [], data: null, error: null })).toEqual({
      candidates: [],
      loadError: null,
    });
    expect(
      nextTransferCandidatesAfterLoad({ previous: [member("u-1", "张三")], data: [], error: null })
    ).toEqual({ candidates: [], loadError: null });
  });

  it("失败且有 previous：原样保留（同引用）+ 错误文案，不把失败伪装成空候选", () => {
    const previous = [member("u-1", "张三")];
    const result = nextTransferCandidatesAfterLoad({
      previous,
      data: null,
      error: { message: "network down" },
    });
    expect(result.candidates).toBe(previous);
    expect(result.loadError).toBe(TRANSFER_CANDIDATES_LOAD_ERROR_MESSAGE);
  });

  it("失败且 previous 为空（首次加载即失败）：空候选 + 错误文案", () => {
    const result = nextTransferCandidatesAfterLoad({
      previous: [],
      data: null,
      error: new Error("fetch failed"),
    });
    expect(result.candidates).toEqual([]);
    expect(result.loadError).toBe(TRANSFER_CANDIDATES_LOAD_ERROR_MESSAGE);
  });
});
