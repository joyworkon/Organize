import { describe, expect, it } from "vitest";

import {
  INVITE_WORKSPACES_LOAD_ERROR_MESSAGE,
  nextInviteWorkspacesAfterLoad,
  type InviteWorkspaceRow,
} from "./invite-workspaces-load";

const team = (id: string, name = id): InviteWorkspaceRow => ({ id, name, kind: "team" });
const personal = (id: string): InviteWorkspaceRow => ({ id, name: id, kind: "personal" });

describe("nextInviteWorkspacesAfterLoad", () => {
  it("成功：只留 team 空间并保持查询顺序，建议选首个 team", () => {
    const data = [team("ws-1", "甲空间"), personal("ws-p"), team("ws-2", "乙空间")];
    const result = nextInviteWorkspacesAfterLoad({ previous: [], data, error: null });
    expect(result.workspaces.map((ws) => ws.id)).toEqual(["ws-1", "ws-2"]);
    expect(result.loadError).toBeNull();
    expect(result.preferredChoice).toBe("ws-1");
  });

  it("成功且没有任何 team（data null 或全 personal）：空列表 + __new__", () => {
    expect(nextInviteWorkspacesAfterLoad({ previous: [], data: null, error: null })).toEqual({
      workspaces: [],
      loadError: null,
      preferredChoice: "__new__",
    });
    expect(
      nextInviteWorkspacesAfterLoad({ previous: [], data: [personal("ws-p")], error: null })
        .preferredChoice
    ).toBe("__new__");
  });

  it("失败且有 previous：原样保留（同引用）+ 错误文案 + preferredChoice null（不改用户选择）", () => {
    const previous = [team("ws-1", "旧空间")];
    const result = nextInviteWorkspacesAfterLoad({
      previous,
      data: null,
      error: { message: "network down" },
    });
    expect(result.workspaces).toBe(previous);
    expect(result.loadError).toBe(INVITE_WORKSPACES_LOAD_ERROR_MESSAGE);
    expect(result.preferredChoice).toBeNull();
  });

  it("失败且 previous 为空（首次加载即失败）：空列表 + 错误文案，不产出建议选择", () => {
    const result = nextInviteWorkspacesAfterLoad({
      previous: [],
      data: null,
      error: new Error("fetch failed"),
    });
    expect(result.workspaces).toEqual([]);
    expect(result.loadError).toBe(INVITE_WORKSPACES_LOAD_ERROR_MESSAGE);
    expect(result.preferredChoice).toBeNull();
  });
});
