import { describe, expect, it } from "vitest";
import {
  canEditRole,
  collabRoleLabel,
  isCollabRole,
  saveRpcNameForRole,
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
});
