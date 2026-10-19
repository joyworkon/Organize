import { describe, expect, it } from "vitest";

import {
  resolveResourceRole,
  RESOURCE_ROLE_LOAD_ERROR_MESSAGE,
} from "./resource-role-load";

describe("resolveResourceRole", () => {
  it("成功返回 owner 时原样采用且标为已验证", () => {
    expect(resolveResourceRole({ data: "owner", error: null })).toEqual({
      role: "owner",
      unverified: false,
    });
  });

  it("成功返回 editor 时原样采用且标为已验证", () => {
    expect(resolveResourceRole({ data: "editor", error: null })).toEqual({
      role: "editor",
      unverified: false,
    });
  });

  it("成功返回 viewer 时原样采用且标为已验证", () => {
    expect(resolveResourceRole({ data: "viewer", error: null })).toEqual({
      role: "viewer",
      unverified: false,
    });
  });

  it("error 真值时安全兜底 viewer 并标为未验证", () => {
    expect(
      resolveResourceRole({ data: "editor", error: { message: "permission denied" } })
    ).toEqual({ role: "viewer", unverified: true });
  });

  it("data 为 null 即使没有 error 也标为未验证", () => {
    expect(resolveResourceRole({ data: null, error: null })).toEqual({
      role: "viewer",
      unverified: true,
    });
  });

  it("data 为 undefined 也标为未验证", () => {
    expect(resolveResourceRole({ data: undefined, error: null })).toEqual({
      role: "viewer",
      unverified: true,
    });
  });

  it("非法字符串角色按未验证处理", () => {
    expect(resolveResourceRole({ data: "superadmin", error: null })).toEqual({
      role: "viewer",
      unverified: true,
    });
  });

  it("抛出的异常对象作为 error 传入时同样兜底 viewer", () => {
    expect(resolveResourceRole({ data: null, error: new Error("network down") })).toEqual({
      role: "viewer",
      unverified: true,
    });
  });
});

describe("RESOURCE_ROLE_LOAD_ERROR_MESSAGE", () => {
  it("提示文案如实说明权限未加载且可重试", () => {
    expect(RESOURCE_ROLE_LOAD_ERROR_MESSAGE).toBe("你的权限未加载，暂按只读显示，请重试");
  });
});
