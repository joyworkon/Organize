import { describe, expect, it } from "vitest";

import {
  nextMemberProfilesAfterLoad,
  SPACES_MEMBER_NAMES_LOAD_ERROR_MESSAGE,
  type MemberProfileRow,
} from "./member-names-load";

const profile = (id: string, displayName: string | null = `成员-${id}`): MemberProfileRow => ({
  id,
  display_name: displayName,
  avatar_url: null,
});

describe("nextMemberProfilesAfterLoad", () => {
  it("成功时用新数据替换上次快照并清除错误", () => {
    const previousProfiles = [profile("old")];
    const data = [profile("new", "新昵称")];

    const result = nextMemberProfilesAfterLoad({ previousProfiles, data, error: null });

    expect(result).toEqual({ profiles: data, loadError: null });
    expect(result.profiles).not.toBe(previousProfiles);
  });

  it("查询失败时保留上次快照并返回服务端错误消息", () => {
    const previousProfiles = [profile("alice", "Alice")];

    const result = nextMemberProfilesAfterLoad({
      previousProfiles,
      data: null,
      error: { message: "  permission denied  " },
    });

    expect(result.profiles).toBe(previousProfiles);
    expect(result.loadError).toBe("permission denied");
  });

  it("错误消息为空白时回退到统一提示", () => {
    const previousProfiles = [profile("alice")];

    const result = nextMemberProfilesAfterLoad({
      previousProfiles,
      data: null,
      error: { message: "   " },
    });

    expect(result).toEqual({
      profiles: previousProfiles,
      loadError: SPACES_MEMBER_NAMES_LOAD_ERROR_MESSAGE,
    });
  });

  it("data 为 null 即使没有 error 也按失败处理并保留快照", () => {
    const previousProfiles = [profile("alice")];

    const result = nextMemberProfilesAfterLoad({
      previousProfiles,
      data: null,
      error: null,
    });

    expect(result).toEqual({
      profiles: previousProfiles,
      loadError: SPACES_MEMBER_NAMES_LOAD_ERROR_MESSAGE,
    });
  });

  it("成功返回空数组是真实空态而不是失败", () => {
    const result = nextMemberProfilesAfterLoad({
      previousProfiles: [profile("old")],
      data: [],
      error: null,
    });

    expect(result).toEqual({ profiles: [], loadError: null });
  });
});
