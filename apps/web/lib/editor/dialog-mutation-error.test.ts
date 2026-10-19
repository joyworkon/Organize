import { describe, expect, it } from "vitest";
import { dialogMutationErrorMessage } from "./dialog-mutation-error";

describe("dialogMutationErrorMessage", () => {
  it("prefers the server-provided message when present", () => {
    expect(
      dialogMutationErrorMessage({
        serverMessage: "没有权限删除该评论",
        fallback: "删除评论失败",
      }),
    ).toBe("没有权限删除该评论");
  });

  it("falls back when the server message is missing", () => {
    expect(
      dialogMutationErrorMessage({ fallback: "解决评论失败" }),
    ).toBe("解决评论失败");
  });

  it("falls back when the server message is blank or not a string", () => {
    expect(
      dialogMutationErrorMessage({ serverMessage: "   ", fallback: "编辑评论失败" }),
    ).toBe("编辑评论失败");
    expect(
      dialogMutationErrorMessage({ serverMessage: 500, fallback: "编辑评论失败" }),
    ).toBe("编辑评论失败");
  });

  it("prefixes network failures and ignores any server message", () => {
    expect(
      dialogMutationErrorMessage({
        networkError: true,
        serverMessage: "不应出现",
        fallback: "拒绝建议失败",
      }),
    ).toBe("网络异常，拒绝建议失败");
  });

  it("keeps the accepted-suggestion fallback wording intact", () => {
    const fallback = "建议内容已写入编辑器，但标记为已接受失败，请重试或手动撤销";
    expect(dialogMutationErrorMessage({ networkError: true, fallback })).toBe(
      `网络异常，${fallback}`,
    );
    expect(dialogMutationErrorMessage({ fallback })).toBe(fallback);
  });
});
