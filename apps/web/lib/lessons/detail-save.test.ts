import { describe, expect, it } from "vitest";
import {
  LESSON_SAVE_ERROR_MESSAGE,
  LESSON_SAVE_NOT_FOUND_MESSAGE,
  LESSON_SAVE_UNAUTHORIZED_MESSAGE,
  LESSON_TAG_LINK_SAVE_ERROR_MESSAGE,
  resolveLessonInsertResult,
  resolveLessonSaveUser,
  resolveLessonTagLinkResult,
  resolveLessonUpdateResult,
} from "./detail-save";

describe("resolveLessonSaveUser", () => {
  it("passes through a logged-in user id", () => {
    expect(resolveLessonSaveUser("u1")).toEqual({ kind: "ok", userId: "u1" });
  });

  it("fails with the login-expired message when there is no user (登录过期不再静默)", () => {
    expect(resolveLessonSaveUser(null)).toEqual({
      kind: "failed",
      message: LESSON_SAVE_UNAUTHORIZED_MESSAGE,
    });
  });
});

describe("resolveLessonInsertResult", () => {
  it("saves successfully and returns the new id", () => {
    const plan = resolveLessonInsertResult({ data: { id: "l1" }, error: null });
    expect(plan).toEqual({ kind: "saved", id: "l1" });
  });

  it("fails with the generic save message on insert error", () => {
    const plan = resolveLessonInsertResult({
      data: null,
      error: { message: "insert boom" },
    });
    expect(plan).toEqual({ kind: "failed", message: LESSON_SAVE_ERROR_MESSAGE });
  });

  it("treats null data without error as a failure too, not as saved", () => {
    const plan = resolveLessonInsertResult({ data: null, error: null });
    expect(plan).toEqual({ kind: "failed", message: LESSON_SAVE_ERROR_MESSAGE });
  });
});

describe("resolveLessonUpdateResult", () => {
  it("saves successfully when exactly one row is updated", () => {
    const plan = resolveLessonUpdateResult({
      data: [{ id: "l1" }],
      error: null,
      lessonId: "l1",
    });
    expect(plan).toEqual({ kind: "saved", id: "l1" });
  });

  it("fails with the generic save message on update error", () => {
    const plan = resolveLessonUpdateResult({
      data: null,
      error: { message: "update boom" },
      lessonId: "l1",
    });
    expect(plan).toEqual({ kind: "failed", message: LESSON_SAVE_ERROR_MESSAGE });
  });

  it("fails with the not-found message when update hits 0 rows (RLS/已删除，error 为 null 也不得跳转)", () => {
    const plan = resolveLessonUpdateResult({
      data: [],
      error: null,
      lessonId: "l1",
    });
    expect(plan).toEqual({
      kind: "failed",
      message: LESSON_SAVE_NOT_FOUND_MESSAGE,
    });
  });

  it("treats null data without error as 0 rows (not-found), not as saved", () => {
    const plan = resolveLessonUpdateResult({
      data: null,
      error: null,
      lessonId: "l1",
    });
    expect(plan).toEqual({
      kind: "failed",
      message: LESSON_SAVE_NOT_FOUND_MESSAGE,
    });
  });
});

describe("resolveLessonTagLinkResult", () => {
  it("is ok when the lesson_tags insert succeeds", () => {
    expect(resolveLessonTagLinkResult({ error: null })).toEqual({ kind: "ok" });
  });

  it("fails with the tag-save message when the lesson_tags insert errors (正文已保存但标签失败，需 toast)", () => {
    const plan = resolveLessonTagLinkResult({
      error: { message: "link boom" },
    });
    expect(plan).toEqual({
      kind: "failed",
      message: LESSON_TAG_LINK_SAVE_ERROR_MESSAGE,
    });
  });
});
