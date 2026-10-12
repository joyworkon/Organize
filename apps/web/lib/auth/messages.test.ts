import { describe, expect, it } from "vitest";
import { localizeAuthError } from "./messages";

describe("localizeAuthError", () => {
  it("常见错误翻译为中文", () => {
    expect(localizeAuthError("Invalid login credentials")).toBe("邮箱或密码不正确");
    expect(localizeAuthError("User already registered")).toBe("该邮箱已注册，请直接登录");
  });
  it("未知错误保留原文，空值给兜底", () => {
    expect(localizeAuthError("weird")).toBe("weird");
    expect(localizeAuthError("")).toBe("操作失败，请重试");
  });
});
