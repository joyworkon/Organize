import { describe, expect, it } from "vitest";
import { isImeComposing } from "./submit-guard";

/**
 * F01 回归：输入法组合态守卫。
 * 组合态（isComposing / keyCode 229）的 Enter 必须被识别，避免中文选字误提交。
 */
describe("isImeComposing（F01）", () => {
  it("isComposing=true 时为组合态", () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
  });

  it("keyCode=229（部分平台表达组合态）时为组合态", () => {
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
  });

  it("普通按键不是组合态", () => {
    expect(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 13 })).toBe(false);
    expect(isImeComposing({})).toBe(false);
  });
});
