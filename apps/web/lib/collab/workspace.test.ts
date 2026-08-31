import { describe, expect, it } from "vitest";
import { buildWorkspaceRows, friendlyWorkspaceError } from "./workspace";

const ME = "00000000-0000-0000-0000-000000000001";
const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";

const ws = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `空间-${id}`,
  kind: "team",
  owner_id: ME,
  created_at: "2026-08-01T00:00:00Z",
  ...overrides,
});

const member = (workspaceId: string, userId: string, role: string, joinedAt = "2026-08-02T00:00:00Z") => ({
  workspace_id: workspaceId,
  user_id: userId,
  role,
  joined_at: joinedAt,
});

const profile = (id: string, displayName: string | null) => ({
  id,
  display_name: displayName,
  avatar_url: null,
});

describe("buildWorkspaceRows", () => {
  it("把三份查询行装配成视图模型：成员带档案、isMe 标记、myRole 取成员行", () => {
    const rows = buildWorkspaceRows(
      [ws("ws-1")],
      [member("ws-1", ME, "owner"), member("ws-1", ALICE, "member")],
      [profile(ME, "我"), profile(ALICE, "Alice")],
      ME
    );

    expect(rows).toHaveLength(1);
    const view = rows[0];
    expect(view.id).toBe("ws-1");
    expect(view.myRole).toBe("owner");
    expect(view.members).toHaveLength(2);
    expect(view.members[0]).toMatchObject({
      userId: ME,
      role: "owner",
      displayName: "我",
      isMe: true,
    });
    expect(view.members[1]).toMatchObject({
      userId: ALICE,
      role: "member",
      displayName: "Alice",
      isMe: false,
    });
  });

  it("个人空间（kind=personal）不进管理页", () => {
    const rows = buildWorkspaceRows(
      [ws("ws-1"), ws("ws-personal", { kind: "personal" })],
      [member("ws-1", ME, "owner"), member("ws-personal", ME, "owner")],
      [profile(ME, "我")],
      ME
    );
    expect(rows.map((row) => row.id)).toEqual(["ws-1"]);
  });

  it("成员排序：属主排最前，其余按加入时间", () => {
    const rows = buildWorkspaceRows(
      [ws("ws-1")],
      [
        member("ws-1", BOB, "member", "2026-08-05T00:00:00Z"),
        member("ws-1", ALICE, "member", "2026-08-03T00:00:00Z"),
        member("ws-1", ME, "owner", "2026-08-09T00:00:00Z"),
      ],
      [],
      ME
    );
    expect(rows[0].members.map((m) => m.userId)).toEqual([ME, ALICE, BOB]);
  });

  it("档案缺失回退 null（UI 显示「未设置昵称」）；未知角色回退 guest", () => {
    const rows = buildWorkspaceRows(
      [ws("ws-1")],
      [member("ws-1", ME, "owner"), member("ws-1", ALICE, "weird-role")],
      [profile(ME, "我")],
      ME
    );
    const alice = rows[0].members.find((m) => m.userId === ALICE);
    expect(alice?.displayName).toBeNull();
    expect(alice?.role).toBe("guest");
  });

  it("myRole 兜底：成员行缺失时属主按 owner_id 判 owner，其余判 guest（防御值）", () => {
    const rows = buildWorkspaceRows(
      [ws("ws-1"), ws("ws-2", { owner_id: ALICE })],
      [member("ws-2", ALICE, "owner")],
      [],
      ME
    );
    expect(rows[0].myRole).toBe("owner");
    expect(rows[0].members).toHaveLength(0);
    expect(rows[1].myRole).toBe("guest");
  });

  it("我是被邀请的普通成员时，myRole 如实取 member", () => {
    const rows = buildWorkspaceRows(
      [ws("ws-1", { owner_id: ALICE })],
      [member("ws-1", ALICE, "owner"), member("ws-1", ME, "member")],
      [],
      ME
    );
    expect(rows[0].myRole).toBe("member");
  });
});

describe("friendlyWorkspaceError", () => {
  it("把 063 管理 RPC 的服务端错误翻成可读中文", () => {
    expect(friendlyWorkspaceError({ message: "not workspace owner" })).toBe("只有空间所有者能这样做");
    expect(friendlyWorkspaceError({ message: "transfer ownership first" })).toBe(
      "属主需先移交所有权才能退出或移除"
    );
    expect(friendlyWorkspaceError({ message: "new owner must be a member" })).toBe(
      "新属主必须是该空间的成员"
    );
    expect(friendlyWorkspaceError({ message: "already owner" })).toBe("该成员已经是所有者");
    expect(friendlyWorkspaceError({ message: "workspace not found" })).toBe("空间不存在或已被解散");
    expect(friendlyWorkspaceError({ message: "user not found" })).toBe("该用户不存在");
    expect(friendlyWorkspaceError({ message: "bad role" })).toBe("成员角色不合法");
    expect(friendlyWorkspaceError({ message: "workspace name required" })).toBe("请填写空间名称");
  });

  it("未识别的消息与空错误原样/兜底透出（含 mock 的显式报错）", () => {
    expect(friendlyWorkspaceError({ message: "mock 后端不支持协作成员管理，请在连接真实后端后使用" })).toBe(
      "mock 后端不支持协作成员管理，请在连接真实后端后使用"
    );
    expect(friendlyWorkspaceError({ message: "任意其他错误" })).toBe("任意其他错误");
    expect(friendlyWorkspaceError(null)).toBe("操作失败");
    expect(friendlyWorkspaceError({})).toBe("操作失败");
  });
});
