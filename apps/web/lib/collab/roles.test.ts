import { describe, expect, it } from "vitest";
import {
  canEditRole,
  collabRoleLabel,
  isCollabRole,
  isWorkspaceMemberRole,
  saveRpcNameForRole,
  workspaceMemberRoleLabel,
} from "./roles";

describe("collab roles", () => {
  it("isCollabRole 只认三个合法角色", () => {
    expect(isCollabRole("owner")).toBe(true);
    expect(isCollabRole("editor")).toBe(true);
    expect(isCollabRole("viewer")).toBe(true);
    expect(isCollabRole(null)).toBe(false);
    expect(isCollabRole("member")).toBe(false);
    expect(isCollabRole("")).toBe(false);
  });

  it("canEditRole：owner/editor 可写，viewer 与无角色只读", () => {
    expect(canEditRole("owner")).toBe(true);
    expect(canEditRole("editor")).toBe(true);
    expect(canEditRole("viewer")).toBe(false);
    expect(canEditRole(null)).toBe(false);
    expect(canEditRole(undefined)).toBe(false);
  });

  it("collabRoleLabel 输出中文展示名", () => {
    expect(collabRoleLabel("owner")).toBe("所有者");
    expect(collabRoleLabel("editor")).toBe("可编辑");
    expect(collabRoleLabel("viewer")).toBe("仅查看");
  });

  it("saveRpcNameForRole：属主走 v1 主链，editor 走 065 的 v2", () => {
    expect(saveRpcNameForRole("owner")).toBe("save_note_with_tasks");
    expect(saveRpcNameForRole("editor")).toBe("save_note_with_tasks_v2");
  });

  it("isWorkspaceMemberRole 只认成员管理面三角色（与资源 access_role 是两套）", () => {
    expect(isWorkspaceMemberRole("owner")).toBe(true);
    expect(isWorkspaceMemberRole("member")).toBe(true);
    expect(isWorkspaceMemberRole("guest")).toBe(true);
    expect(isWorkspaceMemberRole("editor")).toBe(false);
    expect(isWorkspaceMemberRole(null)).toBe(false);
    expect(isWorkspaceMemberRole("")).toBe(false);
  });

  it("workspaceMemberRoleLabel 输出成员管理面展示名", () => {
    expect(workspaceMemberRoleLabel("owner")).toBe("所有者");
    expect(workspaceMemberRoleLabel("member")).toBe("成员");
    expect(workspaceMemberRoleLabel("guest")).toBe("访客");
  });
});
