import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteGroup } from "@organize/shared";
import { isNoteGroupsTableMissing, loadNoteGroups, nextGroupsStateAfterLoad } from "./groups";

const groupA: NoteGroup = {
  id: "g1",
  user_id: "u1",
  name: "读书笔记",
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const groupB: NoteGroup = {
  id: "g2",
  user_id: "u1",
  name: "工作",
  sort_order: 1,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

describe("nextGroupsStateAfterLoad", () => {
  it("加载失败时保留已有的 groups 与 membership，不得清空伪装成「全部未分组」", () => {
    const previous = {
      groups: [groupA, groupB],
      membership: new Map([
        ["n1", "g1"],
        ["n2", "g2"],
      ]),
    };
    const plan = nextGroupsStateAfterLoad(previous, null);
    expect(plan.failed).toBe(true);
    expect(plan.keptPrevious).toBe(true);
    expect(plan.groups).toEqual([groupA, groupB]);
    expect(plan.membership.get("n1")).toBe("g1");
    expect(plan.membership.get("n2")).toBe("g2");
  });

  it("成功加载才用新数据整体替换", () => {
    const previous = { groups: [groupA], membership: new Map([["n1", "g1"]]) };
    const result = { groups: [groupB], membership: new Map([["n2", "g2"]]) };
    const plan = nextGroupsStateAfterLoad(previous, result);
    expect(plan.failed).toBe(false);
    expect(plan.keptPrevious).toBe(false);
    expect(plan.groups).toEqual([groupB]);
    expect(plan.membership.get("n1")).toBeUndefined();
    expect(plan.membership.get("n2")).toBe("g2");
  });

  it("首次加载失败落到空态但标记 failed，与「用户真的没有分组」区分", () => {
    const failedPlan = nextGroupsStateAfterLoad(null, null);
    expect(failedPlan.failed).toBe(true);
    expect(failedPlan.keptPrevious).toBe(false);
    expect(failedPlan.groups).toEqual([]);
    expect(failedPlan.membership.size).toBe(0);

    // 成功且服务端没有分组：同样为空，但 failed=false
    const emptyPlan = nextGroupsStateAfterLoad(null, { groups: [], membership: new Map() });
    expect(emptyPlan.failed).toBe(false);
  });
});

describe("isNoteGroupsTableMissing", () => {
  it("识别 PGRST205 / 42P01 及其典型文案为未迁移", () => {
    expect(isNoteGroupsTableMissing(Object.assign(new Error("x"), { code: "PGRST205" }))).toBe(true);
    expect(isNoteGroupsTableMissing(Object.assign(new Error("x"), { code: "42P01" }))).toBe(true);
    expect(isNoteGroupsTableMissing(new Error("Could not find the table 'note_groups' in the schema cache"))).toBe(true);
    expect(isNoteGroupsTableMissing(new Error('relation "note_group_members" does not exist'))).toBe(true);
  });

  it("网络/权限等其他失败不算未迁移，不得空态退化", () => {
    expect(isNoteGroupsTableMissing(new Error("Failed to fetch"))).toBe(false);
    expect(isNoteGroupsTableMissing(new Error("permission denied for table note_groups"))).toBe(false);
    expect(isNoteGroupsTableMissing(new Error("JWT expired"))).toBe(false);
    expect(isNoteGroupsTableMissing(null)).toBe(false);
    expect(isNoteGroupsTableMissing(undefined)).toBe(false);
  });
});

describe("loadNoteGroups", () => {
  function stubClient(
    groups: { data?: unknown; error?: { message: string; code?: string } | null },
    members: { data?: unknown; error?: { message: string; code?: string } | null }
  ) {
    const results: Record<string, { data?: unknown; error?: { message: string; code?: string } | null }> = {
      note_groups: groups,
      note_group_members: members,
    };
    return {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve(results[table] ?? { data: [], error: null });
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  it("查询错误原样抛出并保留错误码（供未迁移判定）", async () => {
    await expect(
      loadNoteGroups(
        stubClient(
          { data: null, error: { message: "Could not find the table 'note_groups' in the schema cache", code: "PGRST205" } },
          { data: [], error: null }
        ),
        "u1"
      )
    ).rejects.toMatchObject({ code: "PGRST205" });
  });

  it("成员表指向已不存在分组的行会被过滤，不进 membership", async () => {
    const state = await loadNoteGroups(
      stubClient(
        { data: [groupA], error: null },
        {
          data: [
            { note_id: "n1", group_id: "g1" },
            { note_id: "n2", group_id: "gone" },
          ],
          error: null,
        }
      ),
      "u1"
    );
    expect(state.groups).toEqual([groupA]);
    expect(state.membership.get("n1")).toBe("g1");
    expect(state.membership.has("n2")).toBe(false);
  });
});
