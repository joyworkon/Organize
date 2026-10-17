import { describe, expect, it, vi } from "vitest";
import { generateNextRecurringTask, requestNextRecurringTask } from "./recurring";

function mockSupabase(rpcImpl: () => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) } as never;
}

describe("requestNextRecurringTask（区分无需生成与生成失败）", () => {
  it("RPC 返回新任务 id 时返回 created", async () => {
    const supabase = mockSupabase(async () => ({ data: "new-task-id", error: null }));
    const result = await requestNextRecurringTask(supabase, "task-1");
    expect(result).toEqual({ status: "created", id: "new-task-id" });
    expect((supabase as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      "complete_recurring_task",
      { p_task_id: "task-1" }
    );
  });

  it("非重复任务 / 已生成过（RPC 返回 null）时返回 none", async () => {
    const supabase = mockSupabase(async () => ({ data: null, error: null }));
    expect(await requestNextRecurringTask(supabase, "task-2")).toEqual({ status: "none" });
  });

  it("RPC 报错时返回 error 并透传错误消息", async () => {
    const supabase = mockSupabase(async () => ({ data: null, error: { message: "rpc boom" } }));
    expect(await requestNextRecurringTask(supabase, "task-3")).toEqual({
      status: "error",
      message: "rpc boom",
    });
  });

  it("RPC 报错但消息为空时回退默认提示", async () => {
    const supabase = mockSupabase(async () => ({ data: null, error: { message: "" } }));
    expect(await requestNextRecurringTask(supabase, "task-3b")).toEqual({
      status: "error",
      message: "生成下一次重复任务失败",
    });
  });

  it("RPC 调用本身抛异常时返回 error 并透传异常消息", async () => {
    const supabase = mockSupabase(async () => { throw new Error("network down"); });
    expect(await requestNextRecurringTask(supabase, "task-4")).toEqual({
      status: "error",
      message: "network down",
    });
  });
});

describe("generateNextRecurringTask（兼容旧调用方的包装，重复任务完成后的幂等生成）", () => {
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
