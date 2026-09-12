import { describe, expect, it } from "vitest";
import { decideReauth, parseReauthIntervalMs, type ReauthIdentity } from "./reauth";

// A05-3：存量连接周期重验的纯策略。协议与撤权生效窗口见
// docs/collab-session-refresh-design.md §3.2/§3.3 与 reauth.ts 文件头。

const user = (id: string, role: ReauthIdentity["role"]): ReauthIdentity => ({
  userId: id,
  role,
  anonymous: false,
});
const anon = (role: ReauthIdentity["role"]): ReauthIdentity => ({
  userId: "anon",
  role,
  anonymous: true,
});

describe("decideReauth", () => {
  it("身份一致且角色不变 → update（readOnly 跟随角色）", () => {
    const d = decideReauth(user("u-1", "editor"), user("u-1", "editor"));
    expect(d).toEqual({ action: "update", identity: user("u-1", "editor"), readOnly: false });
  });

  it("editor→viewer 降级 → update + readOnly（无需重连，每消息检查即生效）", () => {
    const d = decideReauth(user("u-1", "editor"), user("u-1", "viewer"));
    expect(d.action).toBe("update");
    if (d.action === "update") {
      expect(d.readOnly).toBe(true);
      expect(d.identity.role).toBe("viewer");
    }
  });

  it("viewer→editor 升级同样免重连", () => {
    const d = decideReauth(user("u-1", "viewer"), user("u-1", "editor"));
    expect(d.action).toBe("update");
    if (d.action === "update") expect(d.readOnly).toBe(false);
  });

  it("重验无结论（撤权/链接关闭/token 验不过/角色 null）→ close", () => {
    expect(decideReauth(user("u-1", "editor"), null).action).toBe("close");
    expect(decideReauth(anon("editor"), null).action).toBe("close");
  });

  it("登录连接 user id 变化（同页切号/移花接木）→ close", () => {
    expect(decideReauth(user("u-1", "editor"), user("u-2", "editor")).action).toBe("close");
  });

  it("token 形态漂移（share: ↔ JWT）→ close", () => {
    expect(decideReauth(anon("editor"), user("u-1", "editor")).action).toBe("close");
    expect(decideReauth(user("u-1", "editor"), anon("editor")).action).toBe("close");
  });

  it("匿名身份恒一致（token 即身份），角色随链接设置变化", () => {
    const d = decideReauth(anon("editor"), anon("viewer"));
    expect(d.action).toBe("update");
    if (d.action === "update") expect(d.readOnly).toBe(true);
  });
});

describe("parseReauthIntervalMs", () => {
  it("缺省/非法/非正数 → 默认 5 分钟", () => {
    expect(parseReauthIntervalMs(undefined)).toBe(300_000);
    expect(parseReauthIntervalMs("abc")).toBe(300_000);
    expect(parseReauthIntervalMs("0")).toBe(300_000);
    expect(parseReauthIntervalMs("-5")).toBe(300_000);
  });

  it("合法值透传（E2E 用秒级间隔），下限 1s 防病态值", () => {
    expect(parseReauthIntervalMs("2000")).toBe(2_000);
    expect(parseReauthIntervalMs("1")).toBe(1_000);
    expect(parseReauthIntervalMs("60000.9")).toBe(60_000);
  });
});
