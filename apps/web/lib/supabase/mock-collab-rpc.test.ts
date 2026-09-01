import { describe, expect, it } from "vitest";
import { createMockClient } from "./mock-client";

// P5-02 卡 4 的 mock 对齐决策：resource_role 如实返回 owner（mock 单用户世界成立），
// 协作管理面 RPC 一律显式报错 —— 不支持的必须明确报错，不能静默假成功。
describe("mock collab rpc", () => {
  it("resource_role 对 note 返回 owner，其他类型返回 null", async () => {
    const client = createMockClient();
    const note = await client.rpc("resource_role", { p_resource_type: "note", p_resource_id: "note-1" });
    expect(note.error).toBeNull();
    expect(note.data).toBe("owner");

    const task = await client.rpc("resource_role", { p_resource_type: "task", p_resource_id: "task-1" });
    expect(task.error).toBeNull();
    expect(task.data).toBeNull();
  });

  it("协作管理 RPC 显式报错且不返回数据", async () => {
    const client = createMockClient();
    const names = [
      "find_user_by_email",
      "grant_resource",
      "revoke_resource",
      "create_workspace",
      "transfer_note_ownership",
      "transfer_reading_item_ownership",
      "save_note_with_tasks_v2",
    ];
    for (const name of names) {
      const result = await client.rpc(name, {});
      expect(result.data, name).toBeNull();
      expect(result.error?.message, name).toContain("mock 后端不支持协作成员管理");
    }
  });

  it("未实现的无关 RPC 保持既有行为（空成功），不误伤", async () => {
    const client = createMockClient();
    const result = await client.rpc("not_a_real_rpc", {});
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });
});
