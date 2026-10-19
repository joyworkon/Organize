import { describe, expect, it } from "vitest";
import {
  deleteTagExceptionOutcome,
  readDeleteTagResult,
  readUpdateTagResult,
  updateTagExceptionOutcome,
} from "./tag-manage-mutation";

describe("readUpdateTagResult", () => {
  it("更新到 1 行时判定成功", () => {
    expect(readUpdateTagResult({ error: null, data: [{ id: "t1" }] })).toEqual({ ok: true });
  });

  it("唯一约束冲突（23505）判定为 duplicate 并提示已有同名标签", () => {
    expect(
      readUpdateTagResult({ error: { code: "23505" }, data: null })
    ).toEqual({ ok: false, reason: "duplicate", toastTitle: "已有同名标签" });
  });

  it("其它 error 判定为 failed 并提示保存失败", () => {
    expect(
      readUpdateTagResult({ error: { code: "42501" }, data: null })
    ).toEqual({ ok: false, reason: "failed", toastTitle: "保存标签失败，请重试" });
  });

  it("无 error 但 0 行（空数组）判定为 not-found", () => {
    expect(readUpdateTagResult({ error: null, data: [] })).toEqual({
      ok: false,
      reason: "not-found",
      toastTitle: "标签不存在或无权限编辑",
    });
  });

  it("无 error 但 data 为 null 判定为 not-found", () => {
    expect(readUpdateTagResult({ error: null, data: null })).toEqual({
      ok: false,
      reason: "not-found",
      toastTitle: "标签不存在或无权限编辑",
    });
  });
});

describe("readDeleteTagResult", () => {
  it("删除到 1 行时判定成功", () => {
    expect(readDeleteTagResult({ error: null, data: [{ id: "t1" }] })).toEqual({ ok: true });
  });

  it("error 判定为 failed 并提示删除失败", () => {
    expect(
      readDeleteTagResult({ error: { code: "42501" }, data: null })
    ).toEqual({ ok: false, reason: "failed", toastTitle: "删除标签失败，请重试" });
  });

  it("无 error 但 0 行判定为 not-found（标签不存在或已被删除）", () => {
    expect(readDeleteTagResult({ error: null, data: [] })).toEqual({
      ok: false,
      reason: "not-found",
      toastTitle: "标签不存在或已被删除",
    });
  });
});

describe("抛异常（网络等）", () => {
  it("重命名/改色异常与保存失败同文案", () => {
    expect(updateTagExceptionOutcome()).toEqual({
      ok: false,
      reason: "failed",
      toastTitle: "保存标签失败，请重试",
    });
  });

  it("删除异常与删除失败同文案", () => {
    expect(deleteTagExceptionOutcome()).toEqual({
      ok: false,
      reason: "failed",
      toastTitle: "删除标签失败，请重试",
    });
  });
});
