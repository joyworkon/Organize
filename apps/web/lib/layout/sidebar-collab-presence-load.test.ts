import { describe, expect, it } from "vitest";
import { nextSidebarPresenceAfterLoad } from "./sidebar-collab-presence-load";

describe("nextSidebarPresenceAfterLoad", () => {
  it("成功探测到协作内容时显示入口并清错", () => {
    expect(nextSidebarPresenceAfterLoad(null, { ok: true, has: true })).toEqual({
      has: true,
      loadError: null,
    });
  });

  it("成功且为空时隐藏入口并清错", () => {
    expect(nextSidebarPresenceAfterLoad(true, { ok: true, has: false })).toEqual({
      has: false,
      loadError: null,
    });
  });

  it("失败时保留上次已知的 true", () => {
    expect(
      nextSidebarPresenceAfterLoad(true, { ok: false, error: "读取失败" })
    ).toEqual({ has: true, loadError: "读取失败" });
  });

  it("失败时保留上次已知的 false", () => {
    expect(
      nextSidebarPresenceAfterLoad(false, { ok: false, error: "读取失败" })
    ).toEqual({ has: false, loadError: "读取失败" });
  });

  it("首次失败时 fail-open，不把入口伪装成不存在", () => {
    expect(
      nextSidebarPresenceAfterLoad(null, { ok: false, error: "网络不可用" })
    ).toEqual({ has: true, loadError: "网络不可用" });
  });

  it("原样透传错误字符串", () => {
    const error = "与我共享状态读取失败";
    expect(nextSidebarPresenceAfterLoad(false, { ok: false, error }).loadError).toBe(error);
  });
});
