import { describe, expect, it, vi } from "vitest";
import { generateNextRecurringTask } from "./recurring";

function mockSupabase(rpcImpl: () => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) } as never;
}

describe("generateNextRecurringTask（重复任务完成后的幂等生成）", () => {
  it("调用 complete_recurring_task 并返回新任务 id", async () => {
    const supabase = mockSupabase(async () => ({ data: "new-task-id", error: null }));
    const result = await generateNextRecurringTask(supabase, "task-1");
    expect(result).toBe("new-task-id");
    expect((supabase as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      "complete_recurring_task",
      { p_task_id: "task-1" }
    );
  });

  it("非重复任务 / 已生成过（RPC 返回 null）时返回 null", async () => {
    const supabase = mockSupabase(async () => ({ data: null, error: null }));
    expect(await generateNextRecurringTask(supabase, "task-2")).toBeNull();
  });

  it("RPC 报错时不抛出，返回 null（完成状态不回滚）", async () => {
    const supabase = mockSupabase(async () => ({ data: null, error: new Error("boom") }));
    expect(await generateNextRecurringTask(supabase, "task-3")).toBeNull();
  });

  it("RPC 调用本身抛异常时不抛出，返回 null", async () => {
    const supabase = mockSupabase(async () => { throw new Error("network"); });
    expect(await generateNextRecurringTask(supabase, "task-4")).toBeNull();
  });
});
