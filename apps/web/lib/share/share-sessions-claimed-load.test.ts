import { describe, expect, it } from "vitest";

import {
  nextShareSessionsClaimedAfterLoad,
  type ShareSessionsClaimed,
} from "./share-sessions-claimed-load";

const summary = (active: number): ShareSessionsClaimed => ({
  active,
  released: 0,
  ips: active > 0 ? ["192.0.2.1"] : [],
});

describe("nextShareSessionsClaimedAfterLoad", () => {
  it("成功时替换为最新概览并清除错误", () => {
    const previous = summary(1);
    const next = summary(2);
    const result = nextShareSessionsClaimedAfterLoad(previous, { ok: true, claimed: next });
    expect(result.claimed).toBe(next);
    expect(result.loadError).toBeNull();
  });

  it("失败时保留上次成功概览的同引用", () => {
    const previous = summary(1);
    const result = nextShareSessionsClaimedAfterLoad(previous, {
      ok: false,
      error: "名额占用读取失败",
    });
    expect(result.claimed).toBe(previous);
  });

  it("从未成功时失败返回 null 与错误", () => {
    expect(
      nextShareSessionsClaimedAfterLoad(null, { ok: false, error: "网络不可用" })
    ).toEqual({ claimed: null, loadError: "网络不可用" });
  });

  it("成功时 active=0 是合法概览", () => {
    const claimed = summary(0);
    const result = nextShareSessionsClaimedAfterLoad(summary(1), { ok: true, claimed });
    expect(result).toEqual({ claimed, loadError: null });
    expect(result.claimed?.active).toBe(0);
  });

  it("失败时原样返回传入的 error 字符串", () => {
    const error = "list_share_sessions: permission denied";
    const result = nextShareSessionsClaimedAfterLoad(summary(1), { ok: false, error });
    expect(result.loadError).toBe(error);
  });
});
