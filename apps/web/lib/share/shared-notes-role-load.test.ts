import { describe, expect, it } from "vitest";

import {
  resolveSharedNoteRole,
  sharedNotesRoleLoadError,
  SHARED_NOTE_ROLE_UNVERIFIED_LABEL,
  SHARED_NOTES_ROLE_LOAD_ERROR_MESSAGE,
} from "./shared-notes-role-load";

describe("resolveSharedNoteRole", () => {
  it("成功返回 owner 时原样采用且标为已验证", () => {
    expect(resolveSharedNoteRole({ data: "owner", error: null })).toEqual({
      myRole: "owner",
      roleUnverified: false,
    });
  });

  it("成功返回 editor 时原样采用且标为已验证", () => {
    expect(resolveSharedNoteRole({ data: "editor", error: null })).toEqual({
      myRole: "editor",
      roleUnverified: false,
    });
  });

  it("error 真值时安全兜底 viewer 并标为未验证", () => {
    expect(
      resolveSharedNoteRole({ data: "editor", error: { message: "permission denied" } })
    ).toEqual({ myRole: "viewer", roleUnverified: true });
  });

  it("data 为 null 即使没有 error 也标为未验证", () => {
    expect(resolveSharedNoteRole({ data: null, error: null })).toEqual({
      myRole: "viewer",
      roleUnverified: true,
    });
  });

  it("非法字符串角色按未验证处理", () => {
    expect(resolveSharedNoteRole({ data: "superadmin", error: null })).toEqual({
      myRole: "viewer",
      roleUnverified: true,
    });
  });

  it("抛出的异常对象作为 error 传入时同样兜底 viewer", () => {
    expect(resolveSharedNoteRole({ data: null, error: new Error("network down") })).toEqual({
      myRole: "viewer",
      roleUnverified: true,
    });
  });
});

describe("sharedNotesRoleLoadError", () => {
  it("任一条目未验证时返回统一提示", () => {
    expect(
      sharedNotesRoleLoadError([{ roleUnverified: false }, { roleUnverified: true }])
    ).toBe(SHARED_NOTES_ROLE_LOAD_ERROR_MESSAGE);
  });

  it("全部已验证时返回 null", () => {
    expect(
      sharedNotesRoleLoadError([{ roleUnverified: false }, { roleUnverified: false }])
    ).toBeNull();
  });

  it("空数组返回 null", () => {
    expect(sharedNotesRoleLoadError([])).toBeNull();
  });
});

describe("SHARED_NOTE_ROLE_UNVERIFIED_LABEL", () => {
  it("未验证角标文案为「权限未加载」", () => {
    expect(SHARED_NOTE_ROLE_UNVERIFIED_LABEL).toBe("权限未加载");
  });
});
