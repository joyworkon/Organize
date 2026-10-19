import { describe, expect, it } from "vitest";

import {
  SHARE_PUBLIC_LINK_LOAD_ERROR_MESSAGE,
  nextSharePublicLinkAfterLoad,
  type SharePublicLinkInfo,
} from "./public-link-load";

const previous: SharePublicLinkInfo = {
  token: "previous-token",
  url: "/s/previous-token",
  is_public: true,
};

const incoming: SharePublicLinkInfo = {
  token: "incoming-token",
  url: "/s/incoming-token",
  is_public: false,
};

describe("nextSharePublicLinkAfterLoad", () => {
  it("失败且有旧快照：原样保留快照并返回固定错误", () => {
    const result = nextSharePublicLinkAfterLoad({ previous, ok: false });

    expect(result.share).toBe(previous);
    expect(result.loadError).toBe(SHARE_PUBLIC_LINK_LOAD_ERROR_MESSAGE);
  });

  it("首次加载失败：没有快照时 share 为 null，但仍返回错误", () => {
    expect(nextSharePublicLinkAfterLoad({ previous: null, ok: false })).toEqual({
      share: null,
      loadError: SHARE_PUBLIC_LINK_LOAD_ERROR_MESSAGE,
    });
  });

  it("失败时忽略响应数据，不把数据当成成功结果", () => {
    expect(nextSharePublicLinkAfterLoad({ previous: null, ok: false, data: incoming })).toEqual({
      share: null,
      loadError: SHARE_PUBLIC_LINK_LOAD_ERROR_MESSAGE,
    });
  });

  it("成功且有非空 token：返回规范化链接并清除错误", () => {
    const data = { ...incoming, ignored: "extra-field" };
    const result = nextSharePublicLinkAfterLoad({ previous, ok: true, data });

    expect(result).toEqual({ share: incoming, loadError: null });
  });

  it("成功且 data 为 null：返回合法空态并清除旧快照", () => {
    expect(nextSharePublicLinkAfterLoad({ previous, ok: true, data: null })).toEqual({
      share: null,
      loadError: null,
    });
  });

  it("成功但对象缺 token：按合法空态处理且不报错", () => {
    const data = { url: "/s/missing-token", is_public: true } as SharePublicLinkInfo;

    expect(nextSharePublicLinkAfterLoad({ previous, ok: true, data })).toEqual({
      share: null,
      loadError: null,
    });
  });
});
